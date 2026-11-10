import {test, expect} from 'bun:test';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';

test('local API authorization, revisions, atomic plans, receipts, history and restart', async () => {
	const temp = await fs.mkdtemp(path.resolve('work/api-test-'));
	const reservation = http.createServer();
	await new Promise<void>((r) => reservation.listen(0, '127.0.0.1', r));
	const port = (reservation.address() as {port: number}).port;
	await new Promise<void>((r) => reservation.close(() => r()));
	const base = `http://127.0.0.1:${port}`;
	let child: ReturnType<typeof spawn> | null = null;
	async function start() {
		child = spawn(process.execPath, ['server.ts', '--production'], {
			cwd: process.cwd(),
			env: {
				...process.env,
				REMOTION_PS_PORT: String(port),
				REMOTION_PS_DATA: temp,
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(Error('Server did not start')),
				10000,
			);
			child!.stdout!.on('data', (b) => {
				if (b.toString().includes('Remotion PS:')) {
					clearTimeout(timer);
					resolve();
				}
			});
			child!.once('error', reject);
			child!.once('exit', (code) => {
				clearTimeout(timer);
				reject(Error('Server exited: ' + code));
			});
		});
	}
	async function stop() {
		if (!child) return;
		const stopped = new Promise<void>((r) => child!.once('exit', () => r()));
		child.kill('SIGTERM');
		await stopped;
		child = null;
	}
	try {
		await start();
		let s = await fetch(base + '/api/session').then((r) => r.json());
		const headers = {
			'Content-Type': 'application/json',
			'X-Remotion-PS-Token': s.token,
		};
		const post = (
			route: string,
			value: unknown,
			override?: Record<string, string>,
		) =>
			fetch(base + route, {
				method: 'POST',
				headers: {...headers, ...override},
				body: JSON.stringify(value),
			});
		expect(
			(
				await post(
					'/api/command',
					{
						revision: 0,
						command: {type: 'settings', values: {name: 'Unauthorized'}},
					},
					{'X-Remotion-PS-Token': 'wrong'},
				)
			).status,
		).toBe(403);
		expect(
			(
				await post(
					'/api/command',
					{
						revision: 0,
						command: {type: 'settings', values: {name: 'Cross origin'}},
					},
					{Origin: 'https://external.example'},
				)
			).status,
		).toBe(403);
		const input = {
			revision: 0,
			requestId: 'once',
			command: {type: 'settings', values: {name: 'Saved by agent'}},
		};
		let response = await post('/api/command', input);
		expect(response.status).toBe(200);
		s = await response.json();
		expect(s.revision).toBe(1);
		expect(s.project.name).toBe('Saved by agent');
		response = await post('/api/command', input);
		expect((await response.json()).revision).toBe(1);
		expect(
			(await post('/api/command', {...input, requestId: 'stale'})).status,
		).toBe(409);
		expect(
			(
				await post('/api/command', {
					revision: 1,
					command: {
						type: 'batch',
						commands: [
							{type: 'track', trackId: 'v1', values: {locked: true}},
							{type: 'settings', values: {name: ''}},
						],
					},
				})
			).status,
		).toBe(400);
		s = await fetch(base + '/api/session').then((r) => r.json());
		expect(s.revision).toBe(1);
		expect(s.project.tracks[0].locked).toBe(false);
		response = await post('/api/undo', {revision: 1});
		s = await response.json();
		expect(s.project.name).toBe('Meu primeiro corte');
		expect(s.redoLabel).toBe('Editar projeto');
		response = await post('/api/redo', {revision: 2});
		s = await response.json();
		expect(s.project.name).toBe('Saved by agent');
		expect(s.revision).toBe(3);
		expect(
			JSON.parse(
				await fs.readFile(path.join(temp, 'project.json.recovery'), 'utf8'),
			).revision,
		).toBe(2);
		await stop();
		await start();
		s = await fetch(base + '/api/session').then((r) => r.json());
		expect(s.revision).toBe(3);
		expect(s.project.name).toBe('Saved by agent');
		expect(s.undoLabel).toBe('Editar projeto');
	} finally {
		await stop();
		await fs.rm(temp, {recursive: true, force: true});
	}
}, 30000);
