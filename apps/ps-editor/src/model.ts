import {z} from 'zod';

const frame = z.number().int().min(0).max(10_368_000);
const id = z
	.string()
	.min(1)
	.max(100)
	.regex(/^[a-zA-Z0-9_-]+$/);
export const assetSchema = z.object({
	id,
	name: z.string().min(1).max(250),
	kind: z.enum(['video', 'audio', 'image']),
	src: z.string().regex(/^\/media\/[a-zA-Z0-9_.-]+$/),
	duration: frame.min(1),
	hasAudio: z.boolean(),
	width: z.number().int().min(0).max(16384),
	height: z.number().int().min(0).max(16384),
	peaks: z.array(z.number().min(0).max(1)).max(256),
});
export const clipSchema = z.object({
	id,
	assetId: id,
	trackId: id,
	name: z.string().min(1).max(250),
	from: frame,
	duration: frame.min(1),
	sourceIn: frame,
	linkId: id.nullable(),
	volume: z.number().min(0).max(2),
	opacity: z.number().min(0).max(1),
	scale: z.number().min(0.1).max(4),
	x: z.number().min(-4000).max(4000),
	y: z.number().min(-4000).max(4000),
});
export const trackSchema = z.object({
	id,
	name: z.string().min(1).max(80),
	kind: z.enum(['video', 'audio']),
	locked: z.boolean(),
	muted: z.boolean(),
});
export const projectSchema = z.object({
	version: z.literal(1),
	name: z.string().min(1).max(120),
	fps: z.number().int().min(1).max(120),
	width: z.number().int().min(160).max(3840).multipleOf(2),
	height: z.number().int().min(90).max(3840).multipleOf(2),
	assets: z.array(assetSchema).max(200),
	tracks: z.array(trackSchema).min(1).max(24),
	clips: z.array(clipSchema).max(2000),
});
export type Asset = z.infer<typeof assetSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type Track = z.infer<typeof trackSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Snapshot = {
	project: Project;
	revision: number;
	undoLabel: string | null;
	redoLabel: string | null;
};
export type Command =
	| {type: 'split'; clipId: string; frame: number}
	| {
			type: 'trim';
			clipId: string;
			frame: number;
			side: 'before' | 'after';
			closeGap: boolean;
	  }
	| {type: 'slip'; clipId: string; delta: number}
	| {type: 'move'; clipId: string; from: number; trackId: string}
	| {type: 'swap'; clipId: string; targetId: string}
	| {type: 'delete'; clipId: string; closeGap: boolean}
	| {type: 'duplicate'; clipId: string}
	| {
			type: 'add';
			assetId: string;
			trackId: string;
			from: number;
			sourceIn: number;
			duration: number;
	  }
	| {type: 'resize'; clipId: string; edge: 'start' | 'end'; frame: number}
	| {
			type: 'update';
			clipId: string;
			values: Partial<
				Pick<Clip, 'name' | 'volume' | 'opacity' | 'scale' | 'x' | 'y'>
			>;
	  }
	| {
			type: 'track';
			trackId: string;
			values: Partial<Pick<Track, 'name' | 'locked' | 'muted'>>;
	  }
	| {type: 'new-track'; kind: 'video' | 'audio'}
	| {
			type: 'settings';
			values: Partial<Pick<Project, 'name' | 'width' | 'height'>>;
	  }
	| {type: 'detach-audio'; clipId: string}
	| {type: 'batch'; commands: Command[]};

const commandSchema = z.discriminatedUnion('type', [
	z.object({type: z.literal('split'), clipId: id, frame}).strict(),
	z
		.object({
			type: z.literal('trim'),
			clipId: id,
			frame,
			side: z.enum(['before', 'after']),
			closeGap: z.boolean(),
		})
		.strict(),
	z
		.object({
			type: z.literal('slip'),
			clipId: id,
			delta: z.number().int().min(-10_368_000).max(10_368_000),
		})
		.strict(),
	z
		.object({type: z.literal('move'), clipId: id, from: frame, trackId: id})
		.strict(),
	z.object({type: z.literal('swap'), clipId: id, targetId: id}).strict(),
	z
		.object({type: z.literal('delete'), clipId: id, closeGap: z.boolean()})
		.strict(),
	z.object({type: z.literal('duplicate'), clipId: id}).strict(),
	z
		.object({
			type: z.literal('add'),
			assetId: id,
			trackId: id,
			from: frame,
			sourceIn: frame,
			duration: frame.min(1),
		})
		.strict(),
	z
		.object({
			type: z.literal('resize'),
			clipId: id,
			edge: z.enum(['start', 'end']),
			frame,
		})
		.strict(),
	z
		.object({
			type: z.literal('update'),
			clipId: id,
			values: clipSchema
				.pick({
					name: true,
					volume: true,
					opacity: true,
					scale: true,
					x: true,
					y: true,
				})
				.partial()
				.strict(),
		})
		.strict(),
	z
		.object({
			type: z.literal('track'),
			trackId: id,
			values: trackSchema
				.pick({name: true, locked: true, muted: true})
				.partial()
				.strict(),
		})
		.strict(),
	z
		.object({type: z.literal('new-track'), kind: z.enum(['video', 'audio'])})
		.strict(),
	z
		.object({
			type: z.literal('settings'),
			values: projectSchema
				.pick({name: true, width: true, height: true})
				.partial()
				.strict(),
		})
		.strict(),
	z.object({type: z.literal('detach-audio'), clipId: id}).strict(),
	z
		.object({
			type: z.literal('batch'),
			commands: z.array(z.unknown()).min(1).max(100),
		})
		.strict(),
]);

export const emptyProject = (): Project => ({
	version: 1,
	name: 'Meu primeiro corte',
	fps: 30,
	width: 1920,
	height: 1080,
	assets: [],
	tracks: [
		{id: 'v1', name: 'Vídeo 1', kind: 'video', locked: false, muted: false},
		{id: 'a1', name: 'Áudio 1', kind: 'audio', locked: false, muted: false},
	],
	clips: [],
});
export const durationOf = (p: Project) =>
	Math.max(1, ...p.clips.map((c) => c.from + c.duration));
export const newId = () => crypto.randomUUID();
export const groupOf = (p: Project, c: Clip) =>
	p.clips.filter(
		(x) => x.id === c.id || (c.linkId !== null && x.linkId === c.linkId),
	);
export const labelOf = (c: Command): string =>
	({
		split: 'Cortar clipe',
		trim: 'Descartar trecho',
		slip: 'Ajustar trecho interno',
		move: 'Mover clipe',
		swap: 'Trocar clipes',
		delete: 'Remover clipe',
		duplicate: 'Duplicar clipe',
		add: 'Adicionar mídia',
		resize: 'Ajustar borda',
		update: 'Editar clipe',
		track: 'Editar faixa',
		'new-track': 'Adicionar faixa',
		settings: 'Editar projeto',
		'detach-audio': 'Separar áudio',
		batch: 'Aplicar plano',
	})[c.type];

export function validateProject(input: unknown): Project {
	const p = projectSchema.parse(input);
	for (const list of [p.assets, p.tracks, p.clips])
		if (new Set(list.map((x) => x.id)).size !== list.length)
			throw Error('IDs repetidos no projeto.');
	for (const c of p.clips) {
		const a = p.assets.find((x) => x.id === c.assetId),
			t = p.tracks.find((x) => x.id === c.trackId);
		if (!a || !t) throw Error('Clipe referencia mídia ou faixa ausente.');
		if (a.kind === 'audio' && t.kind !== 'audio')
			throw Error('Áudio precisa de uma faixa de áudio.');
		if (t.kind === 'audio' && !a.hasAudio)
			throw Error('Esta mídia não possui áudio.');
		if (c.sourceIn + c.duration > a.duration)
			throw Error('O trecho ultrapassa o fim da mídia original.');
		if (c.from + c.duration > 10_368_000)
			throw Error('Duração de projeto excedida.');
	}
	for (const t of p.tracks) {
		const clips = p.clips
			.filter((c) => c.trackId === t.id)
			.sort((a, b) => a.from - b.from);
		for (let i = 1; i < clips.length; i++)
			if (clips[i].from < clips[i - 1].from + clips[i - 1].duration)
				throw Error(
					'Há outro clipe nesse espaço. Use outra faixa ou escolha um espaço livre.',
				);
	}
	return p;
}

// Pure transaction: mouse previews, the server and agent plans share these limits.
export function applyCommand(
	original: Project,
	command: Command,
	depth = 0,
): Project {
	if (depth > 1) throw Error('Planos aninhados não são permitidos.');
	command = commandSchema.parse(command) as Command;
	const p = structuredClone(original);
	if (!command || typeof command !== 'object') throw Error('Comando inválido.');
	if (command.type === 'batch') {
		if (
			!Array.isArray(command.commands) ||
			command.commands.length < 1 ||
			command.commands.length > 100
		)
			throw Error('O plano deve conter de 1 a 100 comandos.');
		return command.commands.reduce(
			(state, c) => applyCommand(state, c, depth + 1),
			p,
		);
	}
	const clip =
		'clipId' in command ? p.clips.find((c) => c.id === command.clipId) : null;
	if ('clipId' in command && !clip)
		throw Error('Clipe não encontrado. Atualize o plano.');
	const group = clip ? groupOf(p, clip) : [];
	const requireEditable = (clips: Clip[]) => {
		if (clips.some((c) => p.tracks.find((t) => t.id === c.trackId)?.locked))
			throw Error(
				'Uma faixa envolvida está bloqueada. Desbloqueie-a para editar.',
			);
	};
	const integer = (n: number) => {
		if (!Number.isSafeInteger(n))
			throw Error('Use um número inteiro de frames.');
		return n;
	};
	const closeGap = (start: number, end: number) => {
		if (
			end <= start ||
			p.clips.some((c) => c.from < end && c.from + c.duration > start)
		)
			return;
		const later = p.clips.filter((c) => c.from >= end);
		requireEditable(later);
		for (const c of later) c.from -= end - start;
	};
	if (clip) requireEditable(group);
	switch (command.type) {
		case 'split': {
			const f = integer(command.frame),
				rightLink = clip!.linkId ? newId() : null;
			if (group.some((c) => f <= c.from || f >= c.from + c.duration))
				throw Error(
					'O corte precisa ficar dentro do clipe e dos seus vínculos.',
				);
			for (const c of group) {
				const left = f - c.from;
				p.clips.push({
					...c,
					id: newId(),
					from: f,
					sourceIn: c.sourceIn + left,
					duration: c.duration - left,
					linkId: rightLink,
				});
				c.duration = left;
			}
			break;
		}
		case 'trim': {
			const f = integer(command.frame),
				start = clip!.from,
				end = start + clip!.duration;
			if (command.side !== 'before' && command.side !== 'after')
				throw Error('Lado de corte inválido.');
			if (group.some((c) => f <= c.from || f >= c.from + c.duration))
				throw Error('Posicione o cursor dentro do clipe para descartar.');
			for (const c of group)
				if (command.side === 'before') {
					const d = f - c.from;
					c.sourceIn += d;
					c.duration -= d;
					c.from = f;
				} else c.duration = f - c.from;
			if (command.closeGap)
				closeGap(
					command.side === 'before' ? start : f,
					command.side === 'before' ? f : end,
				);
			break;
		}
		case 'slip': {
			let delta = integer(command.delta);
			const min = Math.max(...group.map((c) => -c.sourceIn));
			const max = Math.min(
				...group.map(
					(c) =>
						p.assets.find((a) => a.id === c.assetId)!.duration -
						c.sourceIn -
						c.duration,
				),
			);
			delta = Math.max(min, Math.min(max, delta));
			for (const c of group) c.sourceIn += delta;
			break;
		}
		case 'move': {
			const d = integer(command.from) - clip!.from;
			const track = p.tracks.find((t) => t.id === command.trackId);
			if (!track || track.locked)
				throw Error('A faixa de destino não está disponível.');
			if (group.length > 1 && command.trackId !== clip!.trackId)
				throw Error('Mova clipes vinculados na mesma faixa.');
			for (const c of group) c.from += d;
			clip!.trackId = track.id;
			break;
		}
		case 'resize': {
			const f = integer(command.frame),
				delta =
					f -
					(command.edge === 'start' ? clip!.from : clip!.from + clip!.duration);
			if (command.edge !== 'start' && command.edge !== 'end')
				throw Error('Borda inválida.');
			for (const c of group)
				if (command.edge === 'start') {
					c.from += delta;
					c.sourceIn += delta;
					c.duration -= delta;
				} else c.duration += delta;
			break;
		}
		case 'swap': {
			const target = p.clips.find((c) => c.id === command.targetId);
			if (!target || group.some((c) => c.id === target.id))
				throw Error('Escolha outro clipe para trocar.');
			const targets = groupOf(p, target);
			requireEditable(targets);
			if (clip!.trackId !== target.trackId) {
				if (group.length !== 1 || targets.length !== 1)
					throw Error('Troque clipes vinculados na mesma faixa.');
				const oldFrom = clip!.from,
					oldTrack = clip!.trackId;
				clip!.from = target.from;
				clip!.trackId = target.trackId;
				target.from = oldFrom;
				target.trackId = oldTrack;
			} else {
				const [left, right] =
					clip!.from < target.from ? [clip!, target] : [target, clip!];
				const leftGroup = groupOf(p, left),
					rightGroup = groupOf(p, right);
				if (
					leftGroup.length !== rightGroup.length ||
					leftGroup.some(
						(c) =>
							c.from !== left.from ||
							c.duration !== left.duration ||
							!rightGroup.some((r) => r.trackId === c.trackId),
					) ||
					rightGroup.some(
						(c) => c.from !== right.from || c.duration !== right.duration,
					)
				)
					throw Error('Os vínculos dos clipes não são compatíveis para troca.');
				const affected = new Set(leftGroup.map((c) => c.trackId));
				const middle = p.clips.filter(
					(c) =>
						affected.has(c.trackId) &&
						c.from >= left.from + left.duration &&
						c.from + c.duration <= right.from,
				);
				requireEditable(middle);
				const leftFrom = left.from,
					rightFrom = right.from,
					delta = right.duration - left.duration;
				for (const c of middle) c.from += delta;
				for (const c of leftGroup) c.from = rightFrom + delta;
				for (const c of rightGroup) c.from = leftFrom;
			}
			break;
		}
		case 'delete': {
			const start = Math.min(...group.map((c) => c.from)),
				end = Math.max(...group.map((c) => c.from + c.duration));
			p.clips = p.clips.filter((c) => !group.some((x) => x.id === c.id));
			if (command.closeGap) closeGap(start, end);
			break;
		}
		case 'duplicate': {
			const start = Math.min(...group.map((c) => c.from)),
				end = Math.max(...group.map((c) => c.from + c.duration)),
				link = clip!.linkId ? newId() : null;
			for (const c of group)
				p.clips.push({
					...c,
					id: newId(),
					from: c.from + end - start,
					linkId: link,
				});
			break;
		}
		case 'add': {
			const a = p.assets.find((x) => x.id === command.assetId),
				t = p.tracks.find((x) => x.id === command.trackId);
			if (!a || !t || t.locked) throw Error('Mídia ou faixa indisponível.');
			p.clips.push({
				id: newId(),
				assetId: a.id,
				trackId: t.id,
				name: a.name,
				from: integer(command.from),
				sourceIn: integer(command.sourceIn),
				duration: integer(command.duration),
				linkId: null,
				volume: 1,
				opacity: 1,
				scale: 1,
				x: 0,
				y: 0,
			});
			break;
		}
		case 'update': {
			const values = clipSchema
				.pick({
					name: true,
					volume: true,
					opacity: true,
					scale: true,
					x: true,
					y: true,
				})
				.partial()
				.strict()
				.parse(command.values);
			Object.assign(clip!, values);
			break;
		}
		case 'track': {
			const t = p.tracks.find((x) => x.id === command.trackId);
			if (!t) throw Error('Faixa não encontrada.');
			Object.assign(
				t,
				trackSchema
					.pick({name: true, locked: true, muted: true})
					.partial()
					.strict()
					.parse(command.values),
			);
			break;
		}
		case 'new-track': {
			if (command.kind !== 'audio' && command.kind !== 'video')
				throw Error('Tipo de faixa inválido.');
			p.tracks.push({
				id: newId(),
				name: `${command.kind === 'audio' ? 'Áudio' : 'Vídeo'} ${p.tracks.filter((t) => t.kind === command.kind).length + 1}`,
				kind: command.kind,
				locked: false,
				muted: false,
			});
			break;
		}
		case 'settings': {
			Object.assign(
				p,
				projectSchema
					.pick({name: true, width: true, height: true})
					.partial()
					.strict()
					.parse(command.values),
			);
			break;
		}
		case 'detach-audio': {
			const a = p.assets.find((x) => x.id === clip!.assetId)!;
			if (a.kind !== 'video' || !a.hasAudio || clip!.linkId)
				throw Error('Este clipe não tem áudio disponível para separar.');
			const track = {
				id: newId(),
				name: 'Áudio vinculado',
				kind: 'audio' as const,
				locked: false,
				muted: false,
			};
			p.tracks.push(track);
			const link = newId();
			clip!.linkId = link;
			p.clips.push({
				...clip!,
				id: newId(),
				trackId: track.id,
				linkId: link,
				name: `${clip!.name} · áudio`,
			});
			clip!.volume = 0;
			break;
		}
		default:
			throw Error('Comando desconhecido. Nenhuma alteração foi aplicada.');
	}
	return validateProject(p);
}

export function timecode(f: number, fps: number) {
	const n = Math.max(0, Math.round(f));
	return `${String(Math.floor(n / fps / 60)).padStart(2, '0')}:${String(Math.floor(n / fps) % 60).padStart(2, '0')}:${String(n % fps).padStart(2, '0')}`;
}
