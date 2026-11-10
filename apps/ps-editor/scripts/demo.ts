import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
const dir = path.resolve(process.argv[2] ?? '../../work/ps-editor/fixtures');
await fs.mkdir(dir, {recursive: true});
const ffmpeg = process.env.REMOTION_PS_FFMPEG ?? '/opt/homebrew/bin/ffmpeg';
for (const [name, args] of [
	[
		'Movimento.mp4',
		[
			'-f',
			'lavfi',
			'-i',
			'testsrc2=size=640x360:rate=30:duration=12',
			'-f',
			'lavfi',
			'-i',
			'sine=frequency=440:sample_rate=48000:duration=12',
			'-c:v',
			'libx264',
			'-preset',
			'ultrafast',
			'-crf',
			'26',
			'-pix_fmt',
			'yuv420p',
			'-c:a',
			'aac',
			'-shortest',
		],
	],
	[
		'Pulso.wav',
		[
			'-f',
			'lavfi',
			'-i',
			'aevalsrc=0.3*sin(2*PI*(220+110*t)*t):s=16000:d=12',
			'-c:a',
			'pcm_s16le',
		],
	],
] as [string, string[]][]) {
	const r = spawnSync(
		ffmpeg,
		['-v', 'error', '-threads', '2', ...args, '-y', path.join(dir, name)],
		{stdio: 'inherit', timeout: 30000},
	);
	if (r.status !== 0) throw Error('Não foi possível criar a mídia sintética.');
}
console.log(dir);
