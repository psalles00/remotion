import fs from 'node:fs/promises';
import {
	applyCommand,
	durationOf,
	type Command,
	type Snapshot,
} from '../src/model';
const base = process.env.REMOTION_PS_URL ?? 'http://127.0.0.1:4173';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))
	throw Error('Use somente o servidor local do Remotion PS.');
const session = await fetch(base + '/api/session').then(async (r) => {
	if (!r.ok) throw Error('Editor local indisponível.');
	return r.json() as Promise<Snapshot & {token: string}>;
});
const action = process.argv[2] ?? 'context';
if (action === 'context') {
	const {token, ...state} = session;
	console.log(JSON.stringify(state, null, 2));
} else if (action === 'preview' || action === 'apply') {
	const file = process.argv[3];
	if (!file) throw Error('Informe o arquivo do plano: {revision, commands}.');
	const plan = JSON.parse(await fs.readFile(file, 'utf8')) as {
		revision: number;
		commands: Command[];
	};
	if (
		!Number.isSafeInteger(plan.revision) ||
		plan.revision !== session.revision
	)
		throw Error(
			`Plano desatualizado. Revisão atual: ${session.revision}. Exporte o contexto novamente.`,
		);
	const project = applyCommand(session.project, {
		type: 'batch',
		commands: plan.commands,
	});
	if (action === 'preview')
		console.log(
			JSON.stringify(
				{
					revision: session.revision,
					commands: plan.commands.length,
					clipsBefore: session.project.clips.length,
					clipsAfter: project.clips.length,
					framesBefore: durationOf(session.project),
					framesAfter: durationOf(project),
					changedClips: project.clips.filter(
						(c) =>
							JSON.stringify(c) !==
							JSON.stringify(session.project.clips.find((x) => x.id === c.id)),
					),
				},
				null,
				2,
			),
		);
	else {
		const response = await fetch(base + '/api/command', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Remotion-PS-Token': session.token,
			},
			body: JSON.stringify({
				revision: plan.revision,
				requestId: crypto.randomUUID(),
				command: {type: 'batch', commands: plan.commands},
			}),
		});
		const result = await response.json();
		if (!response.ok) throw Error(result.error);
		console.log(
			JSON.stringify({
				revision: result.revision,
				clips: result.project.clips.length,
				undoLabel: result.undoLabel,
			}),
		);
	}
} else
	throw Error('Comandos: context | preview plano.json | apply plano.json.');
