import http from 'node:http';
import {createReadStream} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {randomBytes} from 'node:crypto';
import {
	applyCommand,
	emptyProject,
	labelOf,
	validateProject,
	durationOf,
	type Project,
	type Snapshot,
	type Asset,
	type Command,
	assetSchema,
} from './src/model';

const root = path.dirname(fileURLToPath(import.meta.url));
const data = path.resolve(
	process.env.REMOTION_PS_DATA ?? path.join(root, 'local-data'),
);
const media = path.join(data, 'media');
const port = Number(process.env.REMOTION_PS_PORT ?? 4173);
const token = randomBytes(32).toString('hex');
await fs.mkdir(media, {recursive: true});
await fs.mkdir(path.join(data, 'exports'), {recursive: true});
type Entry = {project: Project; label: string};
let store: {
	project: Project;
	revision: number;
	past: Entry[];
	future: Entry[];
} = {project: emptyProject(), revision: 0, past: [], future: []};
const storePath = path.join(data, 'project.json');
try {
	const saved = JSON.parse(await fs.readFile(storePath, 'utf8'));
	if (
		!Number.isSafeInteger(saved.revision) ||
		!Array.isArray(saved.past) ||
		!Array.isArray(saved.future)
	)
		throw Error('Histórico inválido.');
	store = {
		project: validateProject(saved.project),
		revision: saved.revision,
		past: saved.past
			.slice(-50)
			.map((e: Entry) => ({...e, project: validateProject(e.project)})),
		future: saved.future
			.slice(-50)
			.map((e: Entry) => ({...e, project: validateProject(e.project)})),
	};
} catch (e) {
	if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
		throw Error(
			`Não foi possível abrir ${storePath}. O arquivo foi preservado. ${String(e)}`,
		);
}
for (const a of store.project.assets) {
	await fs
		.writeFile(path.join(media, a.id + '.json'), JSON.stringify(a), {
			flag: 'wx',
		})
		.catch((e) => {
			if (e.code !== 'EEXIST') throw e;
		});
}
const snapshot = (): Snapshot => ({
	project: store.project,
	revision: store.revision,
	undoLabel: store.past.at(-1)?.label ?? null,
	redoLabel: store.future.at(-1)?.label ?? null,
});
const clients = new Set<http.ServerResponse>();
const receipts = new Map<string, number>();
let queue = Promise.resolve();
const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
	const run = queue.then(fn);
	queue = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
};
async function persist(next: typeof store) {
	const tmp = storePath + '.tmp';
	await fs.writeFile(tmp, JSON.stringify(next));
	// Keep the last valid file as recovery; atomic rename never exposes a partial write.
	try {
		await fs.copyFile(storePath, storePath + '.recovery');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
	}
	await fs.rename(tmp, storePath);
	store = next;
	for (const client of clients)
		client.write(`data: ${JSON.stringify(snapshot())}\n\n`);
}
async function commit(project: Project, label: string) {
	if (JSON.stringify(project) === JSON.stringify(store.project))
		return snapshot();
	await persist({
		project,
		revision: store.revision + 1,
		past: [...store.past, {project: store.project, label}].slice(-50),
		future: [],
	});
	return snapshot();
}
function run(
	program: string,
	args: string[],
	timeout = 30000,
	maxBytes = 2_000_000,
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const child = spawn(program, args, {stdio: ['ignore', 'pipe', 'pipe']});
		let out: Buffer[] = [],
			size = 0,
			err = '';
		const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
		child.stdout.on('data', (chunk: Buffer) => {
			size += chunk.length;
			if (size > maxBytes) child.kill('SIGKILL');
			else out.push(chunk);
		});
		child.stderr.on('data', (c: Buffer) => {
			err = (err + c.toString()).slice(-2000);
		});
		child.on('error', (e) => {
			clearTimeout(timer);
			reject(Error(`Não foi possível executar ${program}: ${e.message}`));
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			code === 0
				? resolve(Buffer.concat(out))
				: reject(
						Error(`${program} não concluiu (${code}): ${err.slice(-400)}`),
					);
		});
	});
}
const ffmpeg = process.env.REMOTION_PS_FFMPEG ?? '/opt/homebrew/bin/ffmpeg';
const ffprobe = process.env.REMOTION_PS_FFPROBE ?? '/opt/homebrew/bin/ffprobe';
async function inspect(
	file: string,
	name: string,
	assetId: string,
): Promise<Asset> {
	const metadata = JSON.parse(
		(
			await run(
				ffprobe,
				['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
				15000,
			)
		).toString(),
	);
	const video = metadata.streams.find(
		(s: {codec_type: string}) => s.codec_type === 'video',
	);
	const hasAudio = metadata.streams.some(
		(s: {codec_type: string}) => s.codec_type === 'audio',
	);
	if (!video && !hasAudio)
		throw Error('O arquivo não contém vídeo, áudio ou imagem compatível.');
	const image = /\.(png|jpe?g|webp)$/i.test(name);
	const seconds = image
		? 3600
		: Number(metadata.format.duration ?? video?.duration);
	if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 7200)
		throw Error('Use mídia de até 2 horas com duração conhecida.');
	const fps = store.project.fps;
	let peaks: number[] = [];
	if (hasAudio) {
		// A low-rate mono envelope is streamed, with a fixed 256-bin result (no whole-file PCM buffer).
		peaks = await new Promise<number[]>((resolve) => {
			const child = spawn(
				ffmpeg,
				[
					'-v',
					'error',
					'-threads',
					'1',
					'-i',
					file,
					'-vn',
					'-ac',
					'1',
					'-ar',
					'8000',
					'-f',
					'f32le',
					'pipe:1',
				],
				{stdio: ['ignore', 'pipe', 'ignore']},
			);
			const bins = new Array<number>(256).fill(0);
			let index = 0,
				tail = Buffer.alloc(0);
			const samplesPerBin = Math.max(1, (seconds * 8000) / 256);
			const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
			child.stdout.on('data', (chunk: Buffer) => {
				const b = Buffer.concat([tail, chunk]);
				let i = 0;
				for (; i + 4 <= b.length; i += 4) {
					const value = Math.abs(b.readFloatLE(i)),
						bin = Math.min(255, Math.floor(index++ / samplesPerBin));
					if (Number.isFinite(value))
						bins[bin] = Math.max(bins[bin], Math.min(1, value));
				}
				tail = b.subarray(i);
			});
			child.on('error', () => {
				clearTimeout(timer);
				resolve([]);
			});
			child.on('close', (code) => {
				clearTimeout(timer);
				resolve(code === 0 ? bins : []);
			});
		});
	}
	if (video && !image) {
		try {
			await run(
				ffmpeg,
				[
					'-v',
					'error',
					'-threads',
					'1',
					'-ss',
					String(Math.min(1, seconds / 2)),
					'-i',
					file,
					'-frames:v',
					'1',
					'-vf',
					'scale=320:-2',
					'-y',
					path.join(media, assetId + '.jpg'),
				],
				15000,
			);
		} catch {
			/* Thumbnail is optional; the original stays available. */
		}
	}
	return {
		id: assetId,
		name,
		kind: image ? 'image' : video ? 'video' : 'audio',
		src: '/media/' + path.basename(file),
		duration: Math.max(1, Math.floor(seconds * fps)),
		hasAudio,
		width: video?.width ?? 0,
		height: video?.height ?? 0,
		peaks,
	};
}
const audioCache = new Map<string, Promise<Buffer>>();
let audioJobs = 0;
let importing = false;
let rendering = false;
const json = (res: http.ServerResponse, status: number, value: unknown) => {
	res.writeHead(status, {
		'Content-Type': 'application/json',
		'Cache-Control': 'no-store',
	});
	res.end(JSON.stringify(value));
};
async function body(req: http.IncomingMessage) {
	let size = 0;
	const chunks: Buffer[] = [];
	for await (const c of req) {
		size += c.length;
		if (size > 4_000_000) throw Error('Plano maior que 4 MB.');
		chunks.push(c);
	}
	return JSON.parse(Buffer.concat(chunks).toString());
}
async function serveFile(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	file: string,
) {
	const info = await fs.stat(file);
	if (!info.isFile()) throw Error('Arquivo indisponível.');
	const ext = path.extname(file).toLowerCase();
	const mime: Record<string, string> = {
		'.mp4': 'video/mp4',
		'.mov': 'video/quicktime',
		'.webm': 'video/webm',
		'.mp3': 'audio/mpeg',
		'.wav': 'audio/wav',
		'.m4a': 'audio/mp4',
		'.aac': 'audio/aac',
		'.ogg': 'audio/ogg',
		'.flac': 'audio/flac',
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.png': 'image/png',
		'.webp': 'image/webp',
		'.html': 'text/html',
		'.js': 'text/javascript',
		'.css': 'text/css',
		'.json': 'application/json',
		'.svg': 'image/svg+xml',
	};
	const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
	let start = 0,
		end = info.size - 1;
	if (range) {
		start = Number(range[1]);
		end = range[2] ? Math.min(Number(range[2]), end) : end;
		if (start > end || start >= info.size) {
			res.writeHead(416, {'Content-Range': `bytes */${info.size}`});
			res.end();
			return;
		}
	}
	res.writeHead(range ? 206 : 200, {
		'Content-Type': mime[ext] ?? 'application/octet-stream',
		'Content-Length': end - start + 1,
		'Accept-Ranges': 'bytes',
		'Cache-Control': 'no-cache',
		...(range ? {'Content-Range': `bytes ${start}-${end}/${info.size}`} : {}),
	});
	await pipeline(createReadStream(file, {start, end}), res);
}
const production = process.argv.includes('--production');
const vite = production
	? null
	: await (
			await import('vite')
		).createServer({root, server: {middlewareMode: true}, appType: 'spa'});
const server = http.createServer(async (req, res) => {
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('Referrer-Policy', 'same-origin');
	try {
		if (
			req.headers.host !== `127.0.0.1:${port}` &&
			req.headers.host !== `localhost:${port}`
		) {
			json(res, 403, {error: 'Host local inválido.'});
			return;
		}
		if (
			req.headers.origin &&
			![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(
				req.headers.origin,
			)
		) {
			json(res, 403, {error: 'Origem não permitida.'});
			return;
		}
		const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
		if (req.method === 'GET' && url.pathname === '/api/session') {
			json(res, 200, {...snapshot(), token});
			return;
		}
		if (req.method === 'GET' && url.pathname === '/api/events') {
			if (url.searchParams.get('token') !== token) {
				json(res, 403, {error: 'Sessão inválida.'});
				return;
			}
			res.writeHead(200, {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-store',
				Connection: 'keep-alive',
			});
			res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
			clients.add(res);
			res.on('close', () => clients.delete(res));
			return;
		}
		if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
			const name = url.pathname.slice(7);
			if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name.startsWith('.'))
				throw Error('Mídia inválida.');
			await serveFile(req, res, path.join(media, name));
			return;
		}
		if (req.method === 'GET' && url.pathname.startsWith('/exports/')) {
			const name = url.pathname.slice(9);
			if (!/^[a-zA-Z0-9_-]+\.mp4$/.test(name))
				throw Error('Exportação inválida.');
			await serveFile(req, res, path.join(data, 'exports', name));
			return;
		}
		if (req.method === 'GET' && url.pathname.startsWith('/audio/')) {
			if (req.headers['x-remotion-ps-token'] !== token) {
				json(res, 403, {error: 'Sessão inválida.'});
				return;
			}
			const match = url.pathname.match(
				/^\/audio\/([a-zA-Z0-9_-]+)\/(\d+)\.wav$/,
			);
			if (!match) throw Error('Trecho de áudio inválido.');
			const a = store.project.assets.find((x) => x.id === match[1]);
			const chunk = Number(match[2]);
			if (!a?.hasAudio || chunk * 10 >= a.duration / store.project.fps)
				throw Error('Áudio fora da mídia.');
			const key = a.id + ':' + chunk;
			if (!audioCache.has(key)) {
				if (audioJobs >= 2) {
					json(res, 429, {error: 'Prévia ocupada.'});
					return;
				}
				audioJobs++;
				const promise = run(
					ffmpeg,
					[
						'-v',
						'error',
						'-threads',
						'1',
						'-ss',
						String(chunk * 10),
						'-i',
						path.join(media, path.basename(a.src)),
						'-t',
						'10',
						'-vn',
						'-ac',
						'1',
						'-ar',
						'16000',
						'-f',
						'wav',
						'pipe:1',
					],
					15000,
					400000,
				).finally(() => audioJobs--);
				audioCache.set(key, promise);
				promise.catch(() => audioCache.delete(key));
				while (audioCache.size > 6)
					audioCache.delete(audioCache.keys().next().value!);
			}
			const buffer = await audioCache.get(key)!;
			res.writeHead(200, {
				'Content-Type': 'audio/wav',
				'Cache-Control': 'no-store',
			});
			res.end(buffer);
			return;
		}
		if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
			if (req.headers['x-remotion-ps-token'] !== token) {
				json(res, 403, {error: 'Sessão inválida. Reabra o editor.'});
				return;
			}
			if (url.pathname === '/api/media') {
				if (importing) {
					json(res, 409, {error: 'Aguarde a importação atual.'});
					return;
				}
				importing = true;
				const assetId = crypto.randomUUID();
				let file = '';
				try {
					const name = path
							.basename(url.searchParams.get('name') ?? 'mídia')
							.slice(0, 250),
						ext = path.extname(name).toLowerCase();
					if (
						!/^\.(mp4|mov|webm|mkv|mp3|wav|m4a|aac|ogg|flac|png|jpg|jpeg|webp)$/.test(
							ext,
						)
					)
						throw Error(
							'Formato não suportado. Use MP4, MOV, WebM, áudio ou imagem.',
						);
					const size = Number(req.headers['content-length']);
					if (!Number.isSafeInteger(size) || size <= 0 || size > 2_000_000_000)
						throw Error('Use um arquivo de até 2 GB.');
					const capacity = await fs.statfs(media);
					if (capacity.bavail * capacity.bsize < size + 512_000_000)
						throw Error(
							'Não há espaço suficiente para importar mantendo 512 MB livres.',
						);
					file = path.join(media, assetId + ext);
					let bytes = 0;
					await pipeline(
						req,
						new Transform({
							transform(chunk, _, done) {
								bytes += chunk.length;
								done(bytes > size ? Error('Tamanho excedido.') : null, chunk);
							},
						}),
						(await import('node:fs')).createWriteStream(file, {flags: 'wx'}),
					);
					if (bytes !== size)
						throw Error('Upload incompleto. Tente importar novamente.');
					const asset = await inspect(file, name, assetId);
					await fs.writeFile(
						path.join(media, assetId + '.json'),
						JSON.stringify(asset),
						{flag: 'wx'},
					);
					const result = await exclusive(() =>
						commit(
							validateProject({
								...store.project,
								assets: [...store.project.assets, asset],
							}),
							'Importar mídia',
						),
					);
					json(res, 200, {...result, asset});
				} catch (e) {
					if (file) await fs.unlink(file).catch(() => undefined);
					await fs
						.unlink(path.join(media, assetId + '.json'))
						.catch(() => undefined);
					await fs
						.unlink(path.join(media, assetId + '.jpg'))
						.catch(() => undefined);
					throw e;
				} finally {
					importing = false;
				}
				return;
			}
			if (!req.headers['content-type']?.startsWith('application/json'))
				throw Error('Use application/json.');
			const input = await body(req);
			if (url.pathname === '/api/render') {
				if (rendering) {
					json(res, 409, {error: 'Já existe uma exportação em andamento.'});
					return;
				}
				if (input.revision !== store.revision) {
					json(res, 409, {
						error: 'O projeto mudou. Revise e exporte novamente.',
					});
					return;
				}
				if (!store.project.clips.length)
					throw Error('Adicione um clipe antes de exportar.');
				const p = structuredClone(store.project);
				if (durationOf(p) > p.fps * 600)
					throw Error(
						'A exportação local está limitada a 10 minutos por vídeo nesta versão.',
					);
				rendering = true;
				res.writeHead(200, {
					'Content-Type': 'text/event-stream',
					'Cache-Control': 'no-store',
				});
				const send = (value: unknown) => {
					if (!res.destroyed) res.write(`data: ${JSON.stringify(value)}\n\n`);
				};
				const {makeCancelSignal, renderMedia, selectComposition} =
					await import('@remotion/renderer');
				const {cancel, cancelSignal} = makeCancelSignal();
				res.on('close', cancel);
				const output = path.join(
					data,
					'exports',
					`remotion-ps-${Date.now()}.mp4`,
				);
				try {
					send({progress: 0, message: 'Preparando composição…'});
					const {bundle} = await import('@remotion/bundler');
					const bundleDir = path.join(root, 'work', 'render-bundle');
					const serveUrl = await bundle({
						entryPoint: path.join(root, 'src/render-entry.tsx'),
						outDir: bundleDir,
						enableCaching: true,
						onProgress: (n) =>
							send({
								progress: (n / 100) * 0.1,
								message: 'Preparando composição…',
							}),
					});
					const inputProps = {
						project: p,
						mediaBase: `http://127.0.0.1:${port}`,
						silent: false,
					};
					const browserExecutable =
						process.env.REMOTION_PS_CHROME ??
						'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
					await fs.access(browserExecutable);
					const composition = await selectComposition({
						serveUrl,
						id: 'RemotionPS',
						inputProps,
						browserExecutable,
					});
					await renderMedia({
						serveUrl,
						composition,
						inputProps,
						browserExecutable,
						outputLocation: output,
						codec: 'h264',
						colorSpace: 'bt709',
						pixelFormat: 'yuv420p',
						imageFormat: 'png',
						audioCodec: 'aac',
						offthreadVideoCacheSizeInBytes: 128 * 1024 * 1024,
						mediaCacheSizeInBytes: 64 * 1024 * 1024,
						offthreadVideoThreads: 1,
						x264Preset: 'veryfast',
						concurrency: 2,
						crf: 20,
						cancelSignal,
						onProgress: ({progress}) =>
							send({
								progress: 0.1 + progress * 0.9,
								message: 'Renderizando vídeo…',
							}),
					});
					send({
						progress: 1,
						url: '/exports/' + path.basename(output),
						message: 'Vídeo exportado',
					});
				} catch (e) {
					await fs.unlink(output).catch(() => undefined);
					send({error: e instanceof Error ? e.message : String(e)});
				} finally {
					rendering = false;
					res.end();
				}
				return;
			}
			const result = await exclusive(async () => {
				if (input.requestId && receipts.has(input.requestId)) return snapshot();
				if (input.revision !== store.revision) {
					const err = Error(
						'O projeto mudou em outra janela ou por um agente. Revise e tente novamente.',
					);
					Object.assign(err, {status: 409});
					throw err;
				}
				let result: Snapshot;
				if (url.pathname === '/api/command')
					result = await commit(
						applyCommand(store.project, input.command as Command),
						labelOf(input.command),
					);
				else if (url.pathname === '/api/undo' || url.pathname === '/api/redo') {
					const undo = url.pathname.endsWith('undo'),
						source = undo ? store.past : store.future,
						entry = source.at(-1);
					if (!entry) return snapshot();
					const next = {
						...store,
						project: entry.project,
						revision: store.revision + 1,
					};
					if (undo) {
						next.past = store.past.slice(0, -1);
						next.future = [
							...store.future,
							{project: store.project, label: entry.label},
						].slice(-50);
					} else {
						next.future = store.future.slice(0, -1);
						next.past = [
							...store.past,
							{project: store.project, label: entry.label},
						].slice(-50);
					}
					await persist(next);
					result = snapshot();
				} else if (url.pathname === '/api/project') {
					const project = validateProject(input.project);
					if (project.fps !== store.project.fps)
						throw Error(
							'Este projeto usa outro FPS. Esta versão mantém a base de 30 fps.',
						);
					for (const a of project.assets) {
						const known =
							store.project.assets.find((x) => x.id === a.id) ??
							(await fs
								.readFile(path.join(media, a.id + '.json'), 'utf8')
								.then((text) => assetSchema.parse(JSON.parse(text)))
								.catch(() => null));
						if (
							!known ||
							known.src !== a.src ||
							JSON.stringify(known) !== JSON.stringify(a)
						)
							throw Error(
								'As mídias deste projeto não estão nesta biblioteca local. Importe os originais antes de abrir.',
							);
					}
					result = await commit(project, 'Abrir projeto');
				} else throw Error('Operação desconhecida.');
				if (
					typeof input.requestId === 'string' &&
					input.requestId.length <= 100
				) {
					receipts.set(input.requestId, store.revision);
					while (receipts.size > 64)
						receipts.delete(receipts.keys().next().value!);
				}
				return result;
			});
			json(res, 200, result);
			return;
		}
		if (url.pathname.startsWith('/api/')) {
			json(res, 404, {error: 'Operação não encontrada.'});
			return;
		}
		if (vite) {
			vite.middlewares(req, res);
			return;
		}
		const relative =
			url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
		const file = path.resolve(root, 'dist', relative);
		if (!file.startsWith(path.join(root, 'dist') + path.sep))
			throw Error('Caminho inválido.');
		await serveFile(req, res, file);
	} catch (e) {
		if (res.headersSent) {
			res.end();
			return;
		}
		json(res, (e as {status?: number}).status ?? 400, {
			error: e instanceof Error ? e.message : String(e),
		});
	}
});
server.listen(port, '127.0.0.1', () =>
	console.log(`Remotion PS: http://127.0.0.1:${port}\nDados locais: ${data}`),
);
server.on('error', async (e) => {
	console.error(e.message);
	await vite?.close();
	process.exit(1);
});
process.on('SIGTERM', () => {
	for (const c of clients) c.end();
	server.close();
	vite?.close().finally(() => process.exit(0));
});
