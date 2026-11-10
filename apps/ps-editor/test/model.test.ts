import {test, expect} from 'bun:test';
import {
	applyCommand,
	validateProject,
	emptyProject,
	type Project,
	type Clip,
} from '../src/model';
function fixture(): Project {
	const p = emptyProject();
	p.assets = [
		{
			id: 'm',
			name: 'Teste',
			kind: 'video',
			src: '/media/test.mp4',
			duration: 600,
			hasAudio: true,
			width: 640,
			height: 360,
			peaks: [],
		},
	];
	p.clips = [clip('one', 0, 90, 60), clip('two', 90, 90, 180)];
	return p;
}
function clip(
	id: string,
	from: number,
	duration: number,
	sourceIn = 0,
	trackId = 'v1',
): Clip {
	return {
		id,
		from,
		duration,
		sourceIn,
		trackId,
		assetId: 'm',
		name: id,
		linkId: null,
		volume: 1,
		opacity: 1,
		scale: 1,
		x: 0,
		y: 0,
	};
}
test('split preserves all source frames and never mutates input', () => {
	const p = fixture(),
		n = applyCommand(p, {type: 'split', clipId: 'one', frame: 30});
	expect(p.clips).toHaveLength(2);
	expect(n.clips).toHaveLength(3);
	expect(n.clips.find((c) => c.id === 'one')?.duration).toBe(30);
	expect(n.clips.find((c) => c.from === 30)?.sourceIn).toBe(90);
	expect(n.clips.reduce((n, c) => n + c.duration, 0)).toBe(180);
});
for (const frame of [0, 90, -1, NaN, Infinity, 1.5])
	test(`split rejects boundary/hostile frame ${frame}`, () =>
		expect(() =>
			applyCommand(fixture(), {type: 'split', clipId: 'one', frame}),
		).toThrow());
test('trim before closes only newly empty time', () => {
	const n = applyCommand(fixture(), {
		type: 'trim',
		clipId: 'one',
		frame: 30,
		side: 'before',
		closeGap: true,
	});
	expect(n.clips[0]).toMatchObject({from: 0, sourceIn: 90, duration: 60});
	expect(n.clips[1].from).toBe(60);
});
test('trim after closes discarded range and moves later clip', () => {
	const n = applyCommand(fixture(), {
		type: 'trim',
		clipId: 'one',
		frame: 30,
		side: 'after',
		closeGap: true,
	});
	expect(n.clips[0].duration).toBe(30);
	expect(n.clips[1].from).toBe(30);
});
test('muted audio in discarded range prevents closing', () => {
	const p = fixture();
	p.tracks[1].muted = true;
	p.clips.push(clip('audio', 0, 180, 0, 'a1'));
	const n = applyCommand(p, {
		type: 'trim',
		clipId: 'one',
		frame: 30,
		side: 'before',
		closeGap: true,
	});
	expect(n.clips[0].from).toBe(30);
	expect(n.clips[1].from).toBe(90);
});
test('locked later track aborts entire ripple transaction', () => {
	const p = fixture();
	p.tracks[1].locked = true;
	p.clips.push(clip('later', 200, 90, 0, 'a1'));
	expect(() =>
		applyCommand(p, {
			type: 'trim',
			clipId: 'one',
			frame: 30,
			side: 'after',
			closeGap: true,
		}),
	).toThrow('bloqueada');
	expect(p.clips[0].duration).toBe(90);
});
test('slip clamps to both source limits and preserves timing', () => {
	const p = fixture();
	const n = applyCommand(p, {type: 'slip', clipId: 'one', delta: 99999});
	expect(n.clips[0]).toMatchObject({from: 0, duration: 90, sourceIn: 510});
	const low = applyCommand(p, {type: 'slip', clipId: 'one', delta: -999});
	expect(low.clips[0].sourceIn).toBe(0);
});
test('detached audio follows slip, split, trim and undo-compatible immutable state', () => {
	const p = applyCommand(fixture(), {type: 'detach-audio', clipId: 'one'});
	const audio = p.clips.find((c) => c.linkId && c.trackId !== 'v1')!;
	expect(p.clips[0].volume).toBe(0);
	expect(audio.volume).toBe(1);
	const n = applyCommand(p, {type: 'slip', clipId: 'one', delta: 30});
	expect(n.clips.find((c) => c.id === audio.id)?.sourceIn).toBe(90);
	const split = applyCommand(n, {type: 'split', clipId: 'one', frame: 45});
	expect(split.clips.filter((c) => c.from === 45)).toHaveLength(2);
	expect(split.clips.filter((c) => c.from === 45)[0].linkId).toBe(
		split.clips.filter((c) => c.from === 45)[1].linkId,
	);
	expect(split.clips.filter((c) => c.from === 45)[0].linkId).not.toBe(
		p.clips[0].linkId,
	);
});
test('linked media uses tighter slip limit', () => {
	const p = fixture();
	p.clips.push({...clip('audio', 0, 90, 500, 'a1'), linkId: 'pair'});
	p.clips[0].linkId = 'pair';
	const n = applyCommand(p, {type: 'slip', clipId: 'one', delta: 100});
	expect(n.clips[0].sourceIn).toBe(70);
	expect(n.clips[2].sourceIn).toBe(510);
});
test('overlap and locked destinations reject movement', () => {
	expect(() =>
		applyCommand(fixture(), {
			type: 'move',
			clipId: 'one',
			from: 30,
			trackId: 'v1',
		}),
	).toThrow('outro clipe');
	const p = fixture();
	p.tracks[1].locked = true;
	expect(() =>
		applyCommand(p, {type: 'move', clipId: 'one', from: 0, trackId: 'a1'}),
	).toThrow();
});
test('resize retains media correspondence', () => {
	const p = fixture();
	p.clips.pop();
	const n = applyCommand(p, {
		type: 'resize',
		clipId: 'one',
		edge: 'start',
		frame: 30,
	});
	expect(n.clips[0]).toMatchObject({from: 30, sourceIn: 90, duration: 60});
	expect(() =>
		applyCommand(p, {type: 'resize', clipId: 'one', edge: 'end', frame: 700}),
	).toThrow();
});
test('batch is atomic on invalid second operation', () => {
	const p = fixture();
	expect(() =>
		applyCommand(p, {
			type: 'batch',
			commands: [
				{type: 'slip', clipId: 'one', delta: 20},
				{type: 'split', clipId: 'one', frame: 0},
			],
		}),
	).toThrow();
	expect(p.clips[0].sourceIn).toBe(60);
});
test('batch valid plan and empty/oversized/nested plan protection', () => {
	expect(
		applyCommand(fixture(), {
			type: 'batch',
			commands: [{type: 'split', clipId: 'one', frame: 30}],
		}).clips,
	).toHaveLength(3);
	expect(() =>
		applyCommand(fixture(), {type: 'batch', commands: []}),
	).toThrow();
	expect(() =>
		applyCommand(fixture(), {
			type: 'batch',
			commands: [{type: 'batch', commands: []}],
		}),
	).toThrow();
});
test('hostile project and updates are rejected', () => {
	const p = fixture();
	expect(() =>
		validateProject({...p, clips: [p.clips[0], p.clips[0]]}),
	).toThrow('IDs');
	expect(() =>
		validateProject({
			...p,
			assets: [{...p.assets[0], src: 'https://example.com/secret'}],
		}),
	).toThrow();
	expect(() =>
		applyCommand(p, {type: 'update', clipId: 'one', values: {volume: NaN}}),
	).toThrow();
	expect(() =>
		applyCommand(p, {
			type: 'update',
			clipId: 'one',
			values: {sourceIn: 20} as any,
		}),
	).toThrow();
});
test('deleting linked clips and ripple preserves source objects', () => {
	const p = applyCommand(fixture(), {type: 'detach-audio', clipId: 'one'});
	const n = applyCommand(p, {type: 'delete', clipId: 'one', closeGap: true});
	expect(n.clips).toHaveLength(1);
	expect(n.clips[0].from).toBe(0);
	expect(p.clips).toHaveLength(3);
});
test('swap unequal clips moves middle content without losing duration', () => {
	const p = fixture();
	p.clips = [clip('one', 0, 60), clip('middle', 60, 60), clip('two', 120, 90)];
	const n = applyCommand(p, {type: 'swap', clipId: 'one', targetId: 'two'});
	expect(n.clips.find((c) => c.id === 'two')?.from).toBe(0);
	expect(n.clips.find((c) => c.id === 'middle')?.from).toBe(90);
	expect(n.clips.find((c) => c.id === 'one')?.from).toBe(150);
	expect(n.clips.reduce((n, c) => n + c.duration, 0)).toBe(210);
});
test('swap rejects incompatible links or cross-track collisions atomically', () => {
	const p = fixture();
	p.clips.push(clip('third', 0, 180, 0, 'a1'));
	expect(() =>
		applyCommand(p, {type: 'swap', clipId: 'one', targetId: 'third'}),
	).toThrow();
	expect(p.clips[0].trackId).toBe('v1');
	const n = applyCommand(fixture(), {type: 'detach-audio', clipId: 'one'});
	expect(() =>
		applyCommand(n, {type: 'swap', clipId: 'one', targetId: 'two'}),
	).toThrow('vínculos');
});
test('command envelope refuses string booleans and unknown fields', () => {
	expect(() =>
		applyCommand(fixture(), {
			type: 'trim',
			clipId: 'one',
			frame: 30,
			side: 'before',
			closeGap: 'false',
		} as any),
	).toThrow();
	expect(() =>
		applyCommand(fixture(), {
			type: 'slip',
			clipId: 'one',
			delta: 1,
			discard: true,
		} as any),
	).toThrow();
});

function linkedMiddleFixture(): Project {
	const p = fixture();
	p.clips = [
		clip('left', 0, 60),
		clip('middle', 60, 60),
		clip('right', 120, 90),
	];
	return applyCommand(p, {type: 'detach-audio', clipId: 'middle'});
}
test('unequal swap moves the middle clip and its linked audio exactly once', () => {
	const p = linkedMiddleFixture(),
		a = p.clips.find((c) => c.id !== 'middle' && c.linkId)!;
	const n = applyCommand(p, {type: 'swap', clipId: 'left', targetId: 'right'});
	expect(n.clips.find((c) => c.id === 'middle')?.from).toBe(90);
	expect(n.clips.find((c) => c.id === a.id)?.from).toBe(90);
	expect(n.clips.find((c) => c.id === a.id)?.sourceIn).toBe(a.sourceIn);
	expect(n.clips.find((c) => c.id === 'left')?.from).toBe(150);
	expect(p.clips.find((c) => c.id === 'middle')?.from).toBe(60);
});
test('locked audio partner of middle clip refuses the whole swap', () => {
	const p = linkedMiddleFixture(),
		a = p.clips.find((c) => c.id !== 'middle' && c.linkId)!;
	p.tracks.find((t) => t.id === a.trackId)!.locked = true;
	expect(() =>
		applyCommand(p, {type: 'swap', clipId: 'left', targetId: 'right'}),
	).toThrow('bloqueada');
	expect(p.clips.find((c) => c.id === 'left')?.from).toBe(0);
	expect(p.clips.find((c) => c.id === 'middle')?.from).toBe(60);
});
test('collision on linked middle audio track refuses the whole swap', () => {
	const p = linkedMiddleFixture(),
		a = p.clips.find((c) => c.id !== 'middle' && c.linkId)!;
	p.clips.push({...clip('audio-tail', 120, 60, 0, a.trackId)});
	expect(() =>
		applyCommand(p, {type: 'swap', clipId: 'left', targetId: 'right'}),
	).toThrow('outro clipe');
	expect(p.clips.find((c) => c.id === 'middle')?.from).toBe(60);
	expect(p.clips.find((c) => c.id === a.id)?.from).toBe(60);
});
