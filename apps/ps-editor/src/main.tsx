import React, {useState, useEffect, useRef, useCallback, useMemo} from 'react';
import {createRoot} from 'react-dom/client';
import {Player, type PlayerRef} from '@remotion/player';
import {
	Film,
	Plus,
	Upload,
	Undo2,
	Redo2,
	Play,
	Pause,
	SkipBack,
	SkipForward,
	MousePointer2,
	Scissors,
	MoveHorizontal,
	Volume2,
	VolumeX,
	LockKeyhole,
	UnlockKeyhole,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	MoreHorizontal,
	Command as CommandIcon,
	Download,
	FolderOpen,
	Check,
	X,
	Copy,
	Trash2,
	Link2,
	SlidersHorizontal,
	Magnet,
	Keyboard,
	AudioLines,
	Video,
	Image as ImageIcon,
	ZoomIn,
	ZoomOut,
	Eye,
	Terminal,
	CheckCircle2,
	AlertCircle,
	PanelRightClose,
	PanelRightOpen,
} from 'lucide-react';
import {EditComposition} from './Composition';
import {AudioSkimmer} from './audio-skimmer';
import {
	applyCommand,
	durationOf,
	groupOf,
	timecode,
	type Project,
	type Clip,
	type Asset,
	type Snapshot,
	type Command,
} from './model';
import './style.css';

type Tool = 'select' | 'razor' | 'slip';
type Gesture = {
	clip: Clip;
	originX: number;
	originY: number;
	kind: 'move' | 'slip' | 'start' | 'end';
	project: Project;
	revision: number;
	command: Command | null;
	preview: Project | null;
	error: string | null;
	target: HTMLElement;
	pointerId: number;
};
const audio = new AudioSkimmer();
const iconSize = 16;
function IconButton({
	label,
	children,
	active = false,
	...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
	label: string;
	active?: boolean;
}) {
	return (
		<button
			type="button"
			className={`icon-button ${active ? 'active' : ''}`}
			title={label}
			aria-label={label}
			aria-pressed={active || undefined}
			{...props}
		>
			{children}
		</button>
	);
}
function App() {
	const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
		[error, setError] = useState<string | null>(null),
		[notice, setNotice] = useState('Tudo fica neste Mac');
	const session = useRef<{token: string; snapshot: Snapshot} | null>(null),
		[busy, setBusy] = useState(false),
		busyRef = useRef(false);
	const [selected, setSelected] = useState<string | null>(null),
		[tool, setTool] = useState<Tool>('select'),
		[frame, setFrame] = useState(0),
		[hover, setHover] = useState<{frame: number; clipId: string | null} | null>(
			null,
		),
		hoverRef = useRef<typeof hover>(null);
	const [playing, setPlaying] = useState(false),
		playingRef = useRef(false),
		parked = useRef(0),
		player = useRef<PlayerRef>(null);
	const [videoSkim, setVideoSkim] = useState(
			() => localStorage.getItem('ps-video-skim') !== 'false',
		),
		[audioSkim, setAudioSkim] = useState(
			() => localStorage.getItem('ps-audio-skim') !== 'false',
		),
		[audioArmed, setAudioArmed] = useState(false);
	const [zoom, setZoom] = useState(70),
		[snapping, setSnapping] = useState(true),
		[swapOnDrop, setSwapOnDrop] = useState(true),
		[preview, setPreview] = useState<Project | null>(null),
		gesture = useRef<Gesture | null>(null),
		[gestureHint, setGestureHint] = useState<string | null>(null);
	const [panel, setPanel] = useState<'clip' | 'commands' | null>(() =>
			innerWidth > 850 ? 'clip' : null,
		),
		[showHelp, setShowHelp] = useState(false),
		[renderProgress, setRenderProgress] = useState<{
			value: number;
			message: string;
			url: string | null;
		} | null>(null);
	const renderAbort = useRef<AbortController | null>(null),
		[plan, setPlan] = useState(''),
		[planPreview, setPlanPreview] = useState<{
			project: Project;
			revision: number;
			commands: Command[];
		} | null>(null);
	const timeline = useRef<HTMLDivElement>(null),
		fileInput = useRef<HTMLInputElement>(null),
		projectInput = useRef<HTMLInputElement>(null),
		hoverRaf = useRef(0);
	const project = snapshot?.project ?? null,
		visibleProject = preview ?? project;
	const duration = project ? durationOf(project) : 1,
		totalFrames = project
			? Math.max(duration + project.fps * 3, project.fps * 12)
			: 360;
	const ppf = zoom / (project?.fps ?? 30),
		contentWidth = totalFrames * ppf;
	const chosen = project?.clips.find((c) => c.id === selected) ?? null;
	const accept = useCallback((next: Snapshot) => {
		if (session.current && next.revision >= session.current.snapshot.revision) {
			session.current.snapshot = next;
			setSnapshot(next);
		}
	}, []);
	useEffect(() => {
		let events: EventSource | null = null;
		let cancelled = false;
		fetch('/api/session')
			.then(async (r) => {
				if (!r.ok) throw Error('Não foi possível conectar ao editor local.');
				return r.json();
			})
			.then((data) => {
				if (cancelled) return;
				session.current = {token: data.token, snapshot: data};
				audio.token = data.token;
				audio.onError = setError;
				setSnapshot(data);
				events = new EventSource(`/api/events?token=${data.token}`);
				events.onmessage = (e) => accept(JSON.parse(e.data));
				events.onerror = () => {
					events?.close();
					setNotice(
						'Conexão local interrompida. Reabra a página para reconectar.',
					);
				};
			})
			.catch((e) => setError(e.message));
		return () => {
			cancelled = true;
			events?.close();
		};
	}, [accept]);
	useEffect(() => {
		const media = matchMedia('(max-width:850px)');
		const hide = () => {
			if (media.matches) setPanel(null);
		};
		media.addEventListener('change', hide);
		return () => media.removeEventListener('change', hide);
	}, []);
	useEffect(() => {
		if (!error) return;
		const t = setTimeout(() => setError(null), 9000);
		return () => clearTimeout(t);
	}, [error]);
	useEffect(() => {
		localStorage.setItem('ps-video-skim', String(videoSkim));
		if (!videoSkim) clearHover();
	}, [videoSkim]);
	useEffect(() => {
		localStorage.setItem('ps-audio-skim', String(audioSkim));
		if (!audioSkim) audio.stop();
	}, [audioSkim]);
	const request = useCallback(
		async (route: string, payload: Record<string, unknown>) => {
			const s = session.current;
			if (!s) throw Error('Editor desconectado.');
			const response = await fetch(route, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Remotion-PS-Token': s.token,
				},
				body: JSON.stringify({
					revision: s.snapshot.revision,
					requestId: crypto.randomUUID(),
					...payload,
				}),
			});
			const data = await response.json();
			if (!response.ok)
				throw Error(data.error ?? 'A operação não foi concluída.');
			return data;
		},
		[],
	);
	const execute = useCallback(
		async (command: Command, revision?: number) => {
			if (busyRef.current) return;
			busyRef.current = true;
			setBusy(true);
			audio.stop();
			try {
				const result = await request('/api/command', {
					command,
					...(revision === undefined ? {} : {revision}),
				});
				accept(result);
				setNotice('Salvo neste Mac');
				return result as Snapshot;
			} catch (e) {
				setError((e as Error).message);
			} finally {
				busyRef.current = false;
				setBusy(false);
			}
		},
		[accept, request],
	);
	async function history(direction: 'undo' | 'redo') {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		clearHover();
		try {
			accept(await request('/api/' + direction, {}));
			setPreview(null);
			setPlanPreview(null);
			setNotice('Histórico salvo neste Mac');
		} catch (e) {
			setError((e as Error).message);
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}
	function seek(f: number) {
		const next = Math.max(0, Math.min(duration - 1, Math.round(f)));
		parked.current = next;
		setFrame(next);
		player.current?.seekTo(next);
	}
	function clearHover(restore = true) {
		cancelAnimationFrame(hoverRaf.current);
		hoverRef.current = null;
		setHover(null);
		audio.stop();
		if (restore && !playingRef.current && !gesture.current)
			player.current?.seekTo(parked.current);
	}
	function transport() {
		if (playingRef.current) {
			player.current?.pause();
			return;
		}
		const start = hoverRef.current?.frame ?? parked.current;
		clearHover(false);
		seek(start);
		player.current?.play();
	}
	useEffect(() => {
		const p = player.current;
		if (!p) return;
		const update = ({detail}: {detail: {frame: number}}) => {
			if (playingRef.current) {
				parked.current = detail.frame;
				setFrame(detail.frame);
			}
		};
		const play = () => {
			playingRef.current = true;
			setPlaying(true);
			clearHover(false);
		};
		const pause = () => {
			const wasPlaying = playingRef.current;
			playingRef.current = false;
			setPlaying(false);
			if (wasPlaying) {
				parked.current = p.getCurrentFrame();
				setFrame(parked.current);
			}
		};
		p.addEventListener('frameupdate', update);
		p.addEventListener('play', play);
		p.addEventListener('pause', pause);
		p.addEventListener('ended', pause);
		return () => {
			p.removeEventListener('frameupdate', update);
			p.removeEventListener('play', play);
			p.removeEventListener('pause', pause);
			p.removeEventListener('ended', pause);
		};
	}, [Boolean(project)]);
	useEffect(() => {
		if (project && parked.current >= duration) {
			parked.current = Math.max(0, duration - 1);
			setFrame(parked.current);
			player.current?.seekTo(parked.current);
		}
	}, [duration, project]);
	function target() {
		const s = session.current?.snapshot.project;
		if (!s) return null;
		const h = hoverRef.current;
		return (
			s.clips.find((c) => c.id === h?.clipId) ??
			s.clips.find((c) => c.id === selected) ??
			null
		);
	}
	function cut(side?: 'before' | 'after') {
		const c = target();
		if (!c) {
			setError('Selecione um clipe ou passe o cursor sobre ele.');
			return;
		}
		const f = hoverRef.current?.frame ?? parked.current;
		void execute(
			side
				? {type: 'trim', clipId: c.id, frame: f, side, closeGap: true}
				: {type: 'split', clipId: c.id, frame: f},
		);
	}
	function cancelGesture() {
		const g = gesture.current;
		if (!g) return;
		gesture.current = null;
		g.target.releasePointerCapture?.(g.pointerId);
		setPreview(null);
		setGestureHint(null);
		player.current?.seekTo(parked.current);
	}
	useEffect(() => {
		const key = (e: KeyboardEvent) => {
			const el = e.target as HTMLElement;
			if (
				el.closest(
					'input,textarea,select,[contenteditable="true"],dialog[open]',
				)
			)
				return;
			const mod = e.metaKey || e.ctrlKey;
			if (e.key === 'Escape') {
				cancelGesture();
				clearHover();
				setShowHelp(false);
				setPlanPreview(null);
				return;
			}
			if (mod && e.key.toLowerCase() === 'z') {
				e.preventDefault();
				void history(e.shiftKey ? 'redo' : 'undo');
				return;
			}
			if (mod && e.key.toLowerCase() === 'b') {
				e.preventDefault();
				cut();
				return;
			}
			if (mod && (e.key === '=' || e.key === '+')) {
				e.preventDefault();
				setZoom((z) => Math.min(240, z + 20));
				return;
			}
			if (mod && e.key === '-') {
				e.preventDefault();
				setZoom((z) => Math.max(15, z - 20));
				return;
			}
			if (mod || e.altKey) return;
			switch (e.key.toLowerCase()) {
				case ' ':
					e.preventDefault();
					transport();
					break;
				case 'v':
					setTool('select');
					break;
				case 't':
					setTool('slip');
					break;
				case 'c':
					setTool('razor');
					break;
				case ',':
					e.preventDefault();
					cut('before');
					break;
				case '.':
					e.preventDefault();
					cut('after');
					break;
				case 's':
					setSnapping((x) => !x);
					break;
				case 'arrowleft':
					e.preventDefault();
					clearHover(false);
					seek(parked.current - (e.shiftKey ? 10 : 1));
					break;
				case 'arrowright':
					e.preventDefault();
					clearHover(false);
					seek(parked.current + (e.shiftKey ? 10 : 1));
					break;
				case 'backspace':
				case 'delete': {
					const c = target();
					if (c) {
						e.preventDefault();
						void execute({type: 'delete', clipId: c.id, closeGap: e.shiftKey});
					}
					break;
				}
				case '?':
					setShowHelp(true);
					break;
			}
		};
		window.addEventListener('keydown', key);
		return () => window.removeEventListener('keydown', key);
	});
	function onHover(e: React.PointerEvent<HTMLDivElement>) {
		if (
			!project ||
			playingRef.current ||
			gesture.current ||
			e.buttons ||
			e.pointerType === 'touch'
		)
			return;
		const rect = e.currentTarget.getBoundingClientRect();
		const f = Math.max(
			0,
			Math.min(duration - 1, Math.round((e.clientX - rect.left) / ppf)),
		);
		const el = (e.target as HTMLElement).closest<HTMLElement>('[data-clip]');
		const clipId = el?.dataset.clip ?? null;
		if (hoverRef.current?.frame === f && hoverRef.current?.clipId === clipId)
			return;
		cancelAnimationFrame(hoverRaf.current);
		hoverRaf.current = requestAnimationFrame(() => {
			const h = {frame: f, clipId};
			hoverRef.current = h;
			setHover(h);
			if (videoSkim) player.current?.seekTo(f);
			if (audioSkim) void audio.audition(project, f);
		});
	}
	async function arm() {
		try {
			await audio.arm();
			setAudioArmed(true);
		} catch (e) {
			setError((e as Error).message);
		}
	}
	function begin(
		e: React.PointerEvent<HTMLElement>,
		c: Clip,
		edge: 'start' | 'end' | null,
	) {
		if (e.button !== 0 || busyRef.current || !project) return;
		e.stopPropagation();
		void arm();
		if (project.tracks.find((t) => t.id === c.trackId)?.locked) {
			setError('Desbloqueie a faixa para editar.');
			return;
		}
		player.current?.pause();
		setSelected(c.id);
		if (tool === 'razor' && !edge) {
			const rect = timeline
				.current!.querySelector('.time-content')!
				.getBoundingClientRect();
			void execute({
				type: 'split',
				clipId: c.id,
				frame: Math.round((e.clientX - rect.left) / ppf),
			});
			return;
		}
		const kind = edge ?? (tool === 'slip' ? 'slip' : 'move');
		clearHover(false);
		player.current?.seekTo(parked.current);
		e.currentTarget.setPointerCapture(e.pointerId);
		gesture.current = {
			clip: c,
			originX: e.clientX,
			originY: e.clientY,
			kind,
			project,
			revision: snapshot!.revision,
			command: null,
			preview: null,
			error: null,
			target: e.currentTarget,
			pointerId: e.pointerId,
		};
	}
	function drag(e: React.PointerEvent<HTMLElement>) {
		const g = gesture.current;
		if (!g || e.pointerId !== g.pointerId) return;
		let delta = Math.round((e.clientX - g.originX) / ppf);
		if (Math.abs(e.clientX - g.originX) < 3) return;
		const c = g.clip,
			p = g.project;
		let command: Command;
		if (g.kind === 'slip')
			command = {type: 'slip', clipId: c.id, delta: -delta};
		else if (g.kind === 'move') {
			let from = Math.max(0, c.from + delta);
			if (snapping) {
				const boundaries = [
					0,
					parked.current,
					...p.clips
						.filter((x) => !groupOf(p, c).some((a) => a.id === x.id))
						.flatMap((x) => [x.from, x.from + x.duration]),
				];
				let best = 8 / ppf;
				for (const b of boundaries)
					for (const v of [b, b - c.duration])
						if (Math.abs(v - from) < best) {
							best = Math.abs(v - from);
							from = Math.max(0, v);
						}
			}
			const under = document
				.elementFromPoint(e.clientX, e.clientY)
				?.closest<HTMLElement>('[data-track]');
			const trackId = under?.dataset.track ?? c.trackId;
			const content = timeline.current
				?.querySelector('.time-content')
				?.getBoundingClientRect();
			const pointerFrame = content ? (e.clientX - content.left) / ppf : from;
			const target = p.clips.find(
				(x) =>
					x.id !== c.id &&
					x.trackId === trackId &&
					pointerFrame >= x.from &&
					pointerFrame < x.from + x.duration &&
					!groupOf(p, c).some((a) => a.id === x.id),
			);
			command =
				swapOnDrop && target
					? {type: 'swap', clipId: c.id, targetId: target.id}
					: {type: 'move', clipId: c.id, from, trackId};
		} else
			command = {
				type: 'resize',
				clipId: c.id,
				edge: g.kind === 'start' ? 'start' : 'end',
				frame: (g.kind === 'start' ? c.from : c.from + c.duration) + delta,
			};
		try {
			const next = applyCommand(p, command);
			g.command = command;
			g.preview = next;
			g.error = null;
			setPreview(next);
			const nc = next.clips.find((x) => x.id === c.id)!;
			setGestureHint(
				g.kind === 'slip'
					? `Trecho original ${timecode(nc.sourceIn, p.fps)} — ${timecode(nc.sourceIn + nc.duration, p.fps)}`
					: `${timecode(nc.from, p.fps)} · ${timecode(nc.duration, p.fps)}`,
			);
			if (parked.current < c.from || parked.current >= c.from + c.duration)
				player.current?.seekTo(c.from);
		} catch (e) {
			g.command = null;
			g.error = (e as Error).message;
			setGestureHint(g.error);
		}
	}
	async function finish(e: React.PointerEvent<HTMLElement>) {
		const g = gesture.current;
		if (!g || e.pointerId !== g.pointerId) return;
		gesture.current = null;
		g.target.releasePointerCapture?.(g.pointerId);
		setGestureHint(null);
		if (g.command) {
			await execute(g.command, g.revision);
		} else if (g.error) setError(g.error);
		else seek(g.clip.from);
		setPreview(null);
		player.current?.seekTo(parked.current);
	}
	async function importFiles(files: FileList | null) {
		if (!files || !session.current || busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		try {
			for (const file of Array.from(files)) {
				setNotice(`Importando ${file.name}…`);
				const response = await fetch(
					'/api/media?name=' + encodeURIComponent(file.name),
					{
						method: 'POST',
						headers: {'X-Remotion-PS-Token': session.current.token},
						body: file,
					},
				);
				const data = await response.json();
				if (!response.ok) throw Error(data.error);
				accept(data);
			}
			setNotice('Mídia importada e salva neste Mac');
		} catch (e) {
			setError((e as Error).message);
		} finally {
			busyRef.current = false;
			setBusy(false);
			if (fileInput.current) fileInput.current.value = '';
		}
	}
	async function addAsset(a: Asset, at?: number) {
		if (!project) return;
		const type = a.kind === 'audio' ? 'audio' : 'video';
		const track = project.tracks.find((t) => t.kind === type && !t.locked);
		if (!track) {
			setError('Crie ou desbloqueie uma faixa compatível.');
			return;
		}
		const end = Math.max(
			0,
			...project.clips
				.filter((c) => c.trackId === track.id)
				.map((c) => c.from + c.duration),
		);
		const sourceDuration = a.kind === 'image' ? project.fps * 5 : a.duration;
		await execute({
			type: 'add',
			assetId: a.id,
			trackId: track.id,
			from: at ?? end,
			sourceIn: 0,
			duration: sourceDuration,
		});
	}
	function download(data: unknown, name: string) {
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}),
		);
		const a = document.createElement('a');
		a.href = url;
		a.download = name;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
	async function openProject(file: File | undefined) {
		if (!file) return;
		try {
			const p = JSON.parse(await file.text());
			accept(await request('/api/project', {project: p}));
			setSelected(null);
			seek(0);
		} catch (e) {
			setError((e as Error).message);
		} finally {
			if (projectInput.current) projectInput.current.value = '';
		}
	}
	async function exportVideo() {
		if (!session.current || renderAbort.current) return;
		const abort = new AbortController();
		renderAbort.current = abort;
		setRenderProgress({value: 0, message: 'Preparando exportação…', url: null});
		player.current?.pause();
		clearHover();
		try {
			const r = await fetch('/api/render', {
				method: 'POST',
				signal: abort.signal,
				headers: {
					'Content-Type': 'application/json',
					'X-Remotion-PS-Token': session.current.token,
				},
				body: JSON.stringify({revision: session.current.snapshot.revision}),
			});
			if (!r.ok) {
				const result = await r.json();
				throw Error(result.error);
			}
			const reader = r.body!.getReader(),
				decoder = new TextDecoder();
			let text = '';
			let complete = false;
			while (true) {
				const {done, value} = await reader.read();
				if (done) break;
				text += decoder.decode(value, {stream: true});
				const blocks = text.split('\n\n');
				text = blocks.pop()!;
				for (const block of blocks) {
					if (!block.startsWith('data: ')) continue;
					const update = JSON.parse(block.slice(6));
					if (update.error) throw Error(update.error);
					if (update.url) complete = true;
					setRenderProgress({
						value: update.progress,
						message: update.message,
						url: update.url ?? null,
					});
				}
			}
			if (!complete)
				throw Error(
					'A exportação foi interrompida. Verifique o servidor antes de tentar novamente.',
				);
		} catch (e) {
			if ((e as Error).name === 'AbortError') setRenderProgress(null);
			else {
				setError((e as Error).message);
				setRenderProgress(null);
			}
		} finally {
			renderAbort.current = null;
		}
	}
	function inspectPlan() {
		try {
			if (!project) return;
			const parsed = JSON.parse(plan);
			const commands: Command[] = Array.isArray(parsed)
				? parsed
				: parsed.commands;
			if (!Array.isArray(commands))
				throw Error('Cole uma lista de comandos JSON.');
			if (
				parsed.revision !== undefined &&
				parsed.revision !== snapshot!.revision
			)
				throw Error(
					'Este plano usa outra revisão. Exporte um contexto atualizado.',
				);
			const result = applyCommand(project, {type: 'batch', commands});
			setPlanPreview({project: result, revision: snapshot!.revision, commands});
		} catch (e) {
			setPlanPreview(null);
			setError((e as Error).message);
		}
	}
	const inputProps = useMemo(
		() => ({project: visibleProject!, mediaBase: '', silent: false}),
		[visibleProject],
	);
	if (!project || !visibleProject)
		return (
			<main className="loading">
				<Film size={28} />
				<h1>Remotion PS</h1>
				<p>{error ?? 'Abrindo o editor local…'}</p>
			</main>
		);
	const edited = visibleProject.clips.find((c) => c.id === selected) ?? chosen;
	const selectedAsset = chosen
		? project.assets.find((a) => a.id === chosen.assetId)
		: null;
	const commandTarget = hover?.clipId ?? selected;
	const tickSeconds = Math.max(1, Math.ceil(70 / zoom));
	return (
		<div
			className="app"
			onPointerDown={(e) => {
				if (
					!audioArmed &&
					!(e.target as HTMLElement).closest('[data-audio-control]')
				)
					void arm();
			}}
		>
			<input
				ref={fileInput}
				type="file"
				accept="video/*,audio/*,image/png,image/jpeg,image/webp"
				multiple
				hidden
				onChange={(e) => void importFiles(e.target.files)}
			/>
			<input
				ref={projectInput}
				type="file"
				accept=".json"
				hidden
				onChange={(e) => void openProject(e.target.files?.[0])}
			/>
			<header className="app-header">
				<a className="brand" href="/" aria-label="Remotion PS">
					<span className="brand-symbol">
						<Film size={20} />
					</span>
					<span>
						Remotion <b>PS</b>
					</span>
				</a>
				<span className="header-separator" />
				<details className="project-menu">
					<summary>
						{project.name}
						<ChevronDown size={14} />
					</summary>
					<div className="menu">
						<button
							onClick={async () => {
								try {
									accept(
										await request('/api/project', {
											project: {...project, name: 'Novo projeto', clips: []},
										}),
									);
									setSelected(null);
									seek(0);
								} catch (e) {
									setError((e as Error).message);
								}
							}}
						>
							<Plus size={16} />
							Nova timeline
						</button>
						<button
							onClick={() => download(project, 'projeto.remotion-ps.json')}
						>
							<Download size={16} />
							Salvar cópia do projeto
						</button>
						<button onClick={() => projectInput.current?.click()}>
							<FolderOpen size={16} />
							Abrir projeto JSON
						</button>
						<hr />
						<label>
							Nome do projeto
							<input
								aria-label="Nome do projeto"
								key={project.name}
								defaultValue={project.name}
								maxLength={120}
								onBlur={(e) => {
									if (e.target.value && e.target.value !== project.name)
										void execute({
											type: 'settings',
											values: {name: e.target.value},
										});
								}}
							/>
						</label>
						<label>
							Formato
							<select
								aria-label="Formato do projeto"
								value={`${project.width}x${project.height}`}
								onChange={(e) => {
									const [width, height] = e.target.value.split('x').map(Number);
									void execute({type: 'settings', values: {width, height}});
								}}
							>
								<option value="1920x1080">Horizontal · 1920 × 1080</option>
								<option value="1080x1920">Vertical · 1080 × 1920</option>
								<option value="1080x1080">Quadrado · 1080 × 1080</option>
								<option value="960x540">Prévia · 960 × 540</option>
							</select>
						</label>
						<p>30 fps · mídias e histórico neste Mac</p>
					</div>
				</details>
				<span className="save-state">
					<CheckCircle2 size={13} />
					{busy ? 'Salvando…' : 'Salvo localmente'}
				</span>
				<div className="header-actions">
					<IconButton label="Atalhos (?)" onClick={() => setShowHelp(true)}>
						<Keyboard size={17} />
					</IconButton>
					<button
						className="secondary"
						onClick={() => setPanel(panel === 'commands' ? 'clip' : 'commands')}
					>
						<Terminal size={15} />
						<span>Comandos</span>
					</button>
					<button
						className="primary"
						onClick={() => void exportVideo()}
						disabled={!project.clips.length || Boolean(renderAbort.current)}
					>
						<Download size={15} />
						<span>Exportar vídeo</span>
					</button>
				</div>
			</header>
			<div className={`workspace ${panel ? '' : 'panel-closed'}`}>
				<aside className="library" aria-label="Biblioteca de mídia">
					<div className="panel-heading">
						<h2>Mídia</h2>
						<span>{project.assets.length}</span>
						<IconButton
							label="Importar mídia"
							onClick={() => fileInput.current?.click()}
							disabled={busy}
						>
							<Plus size={17} />
						</IconButton>
					</div>
					<button
						className="import-button"
						onClick={() => fileInput.current?.click()}
						disabled={busy}
					>
						<Upload size={16} />
						Importar arquivos
					</button>
					<div
						className="asset-list"
						onDragOver={(e) => e.preventDefault()}
						onDrop={(e) => {
							e.preventDefault();
							void importFiles(e.dataTransfer.files);
						}}
					>
						{!project.assets.length ? (
							<div className="library-empty">
								<FolderOpen size={28} />
								<p>Seus arquivos, à mão.</p>
								<span>
									Arraste vídeo, áudio ou imagem para cá. Os originais são
									preservados.
								</span>
							</div>
						) : (
							project.assets.map((a) => (
								<button
									key={a.id}
									className="asset"
									draggable
									onDragStart={(e) =>
										e.dataTransfer.setData('application/remotion-ps', a.id)
									}
									onDoubleClick={() => void addAsset(a)}
									onClick={() =>
										setNotice(
											'Arraste para a timeline ou dê dois cliques para adicionar ao final.',
										)
									}
									title={`${a.name} · dois cliques para adicionar`}
								>
									<span className={`asset-thumbnail ${a.kind}`}>
										{a.kind === 'video' ? (
											<img
												src={`/media/${a.id}.jpg`}
												alt=""
												onError={(e) =>
													(e.currentTarget.style.visibility = 'hidden')
												}
											/>
										) : a.kind === 'image' ? (
											<img src={a.src} alt="" />
										) : (
											<Wave peaks={a.peaks} start={0} fraction={1} />
										)}
										<span className="asset-kind">
											{a.kind === 'audio' ? (
												<AudioLines size={12} />
											) : a.kind === 'image' ? (
												<ImageIcon size={12} />
											) : (
												<Video size={12} />
											)}
										</span>
										<span className="asset-duration">
											{timecode(
												a.kind === 'image' ? 150 : a.duration,
												project.fps,
											)}
										</span>
									</span>
									<span className="asset-name">{a.name}</span>
								</button>
							))
						)}
					</div>
					<div className="library-foot">
						<LockKeyhole size={12} />
						Sem upload para a nuvem
					</div>
				</aside>
				<main className="monitor">
					<div className="monitor-heading">
						<span>Programa</span>
						<span>
							{project.width} × {project.height}
							<span className="dot" />
							30 fps
						</span>
						<IconButton
							label={panel ? 'Recolher painel' : 'Mostrar propriedades'}
							onClick={() => setPanel(panel ? null : 'clip')}
						>
							{panel ? (
								<PanelRightClose size={15} />
							) : (
								<PanelRightOpen size={15} />
							)}
						</IconButton>
					</div>
					<div className="monitor-stage">
						<Player
							ref={player}
							component={EditComposition}
							inputProps={inputProps}
							durationInFrames={Math.max(1, durationOf(visibleProject))}
							fps={project.fps}
							compositionWidth={project.width}
							compositionHeight={project.height}
							controls={false}
							clickToPlay={false}
							spaceKeyToPlayOrPause={false}
							moveToBeginningWhenEnded={false}
							style={{width: '100%', height: '100%'}}
							errorFallback={({error}) => (
								<div className="media-error">
									<AlertCircle size={24} />
									<p>Não foi possível reproduzir esta mídia.</p>
									<small>{error.message}</small>
									<span>
										Verifique o original e use MP4/H.264 ou WebM compatível com
										o navegador.
									</span>
								</div>
							)}
						/>
						{!project.clips.length && (
							<div className="monitor-empty">
								<span className="empty-mark">
									<Film size={34} />
								</span>
								<h1>Um corte começa com um trecho.</h1>
								<p>
									Importe sua mídia e arraste para a timeline.
									<br />
									Use o mouse para explorar. O teclado para editar.
								</p>
								<button
									className="primary"
									onClick={() => fileInput.current?.click()}
								>
									<Plus size={16} />
									Importar mídia
								</button>
							</div>
						)}
						{hover && videoSkim && !playing && (
							<span className="preview-badge">
								<Eye size={12} />
								Prévia pelo cursor
							</span>
						)}
						{preview && (
							<span className="preview-badge">
								{tool === 'slip'
									? 'Ajustando trecho interno'
									: 'Prévia da edição'}
							</span>
						)}
					</div>
					<div className="transport">
						<span className="timecode" data-testid="parked-frame">
							{timecode(frame, project.fps)}
						</span>
						<div>
							<IconButton
								label="Início"
								onClick={() => {
									clearHover(false);
									seek(0);
								}}
							>
								<SkipBack size={16} />
							</IconButton>
							<IconButton
								label={playing ? 'Pausar (Espaço)' : 'Reproduzir (Espaço)'}
								onClick={transport}
								disabled={!project.clips.length}
							>
								{playing ? <Pause size={19} /> : <Play size={19} />}
							</IconButton>
							<IconButton
								label="Fim"
								onClick={() => {
									clearHover(false);
									seek(duration - 1);
								}}
							>
								<SkipForward size={16} />
							</IconButton>
						</div>
						<span className="timecode muted">
							{timecode(duration, project.fps)}
						</span>
					</div>
				</main>
				{panel && (
					<aside
						className="inspector"
						aria-label={
							panel === 'clip'
								? 'Propriedades do clipe'
								: 'Comandos para agentes'
						}
					>
						<div className="panel-tabs">
							<button
								className={panel === 'clip' ? 'current' : ''}
								onClick={() => setPanel('clip')}
							>
								Clipe
							</button>
							<button
								className={panel === 'commands' ? 'current' : ''}
								onClick={() => setPanel('commands')}
							>
								Agentes
							</button>
							<IconButton label="Fechar painel" onClick={() => setPanel(null)}>
								<X size={14} />
							</IconButton>
						</div>
						{panel === 'clip' ? (
							chosen && edited ? (
								<>
									<div className="inspector-section">
										<div className="inspector-clip-kind">
											{selectedAsset?.kind === 'audio' ? (
												<AudioLines size={15} />
											) : (
												<Video size={15} />
											)}
											<span>
												{selectedAsset?.kind === 'audio'
													? 'Áudio'
													: 'Vídeo / imagem'}
											</span>
											{chosen.linkId && <Link2 size={13} />}
										</div>
										<input
											className="clip-name-input"
											aria-label="Nome do clipe"
											key={chosen.id + chosen.name}
											defaultValue={chosen.name}
											onBlur={(e) => {
												if (e.target.value && e.target.value !== chosen.name)
													void execute({
														type: 'update',
														clipId: chosen.id,
														values: {name: e.target.value},
													});
											}}
										/>
										<dl className="timing">
											<div>
												<dt>Posição</dt>
												<dd>{timecode(edited.from, project.fps)}</dd>
											</div>
											<div>
												<dt>Duração</dt>
												<dd>{timecode(edited.duration, project.fps)}</dd>
											</div>
											<div>
												<dt>Início no original</dt>
												<dd data-testid="source-in">
													{timecode(edited.sourceIn, project.fps)}
												</dd>
											</div>
										</dl>
									</div>
									<div className="inspector-section">
										<h3>Edição rápida</h3>
										<button
											className="wide-action"
											onClick={() => cut()}
											disabled={busy}
										>
											<Scissors size={15} />
											Cortar no cursor<kbd>⌘ B</kbd>
										</button>
										<button
											className="wide-action"
											onClick={() => cut('before')}
											disabled={busy}
										>
											<ChevronLeft size={15} />
											Descartar antes<kbd>,</kbd>
										</button>
										<button
											className="wide-action"
											onClick={() => cut('after')}
											disabled={busy}
										>
											<ChevronRight size={15} />
											Descartar depois<kbd>.</kbd>
										</button>
										<button
											className={`wide-action ${tool === 'slip' ? 'active' : ''}`}
											onClick={() =>
												setTool(tool === 'slip' ? 'select' : 'slip')
											}
										>
											<MoveHorizontal size={15} />
											Ajustar trecho interno<kbd>T</kbd>
										</button>
										<p className="help-copy">
											Arraste o corpo para mover. As bordas ajustam o início e o
											fim. T muda o trecho sem mover o clipe.
										</p>
									</div>
									{selectedAsset?.hasAudio && (
										<div className="inspector-section">
											<h3>Áudio</h3>
											<label className="range-label">
												Volume<span>{Math.round(chosen.volume * 100)}%</span>
												<input
													aria-label="Volume do clipe"
													type="range"
													min="0"
													max="2"
													step=".05"
													key={chosen.id + chosen.volume}
													defaultValue={chosen.volume}
													onPointerUp={(e) =>
														void execute({
															type: 'update',
															clipId: chosen.id,
															values: {volume: Number(e.currentTarget.value)},
														})
													}
													onKeyUp={(e) =>
														void execute({
															type: 'update',
															clipId: chosen.id,
															values: {volume: Number(e.currentTarget.value)},
														})
													}
												/>
											</label>
										</div>
									)}
									<details className="inspector-section advanced">
										<summary>
											<SlidersHorizontal size={14} />
											Mais propriedades
											<ChevronDown size={13} />
										</summary>
										{(['opacity', 'scale', 'x', 'y'] as const).map((key) => (
											<label
												className="number-label"
												key={chosen.id + key + chosen[key]}
											>
												{
													{
														opacity: 'Opacidade',
														scale: 'Escala',
														x: 'Posição X',
														y: 'Posição Y',
													}[key]
												}
												<input
													aria-label={key}
													type="number"
													min={
														key === 'opacity'
															? 0
															: key === 'scale'
																? 0.1
																: -4000
													}
													max={
														key === 'opacity' ? 1 : key === 'scale' ? 4 : 4000
													}
													step={key === 'x' || key === 'y' ? 1 : 0.05}
													defaultValue={chosen[key]}
													onBlur={(e) => {
														if (Number.isFinite(e.target.valueAsNumber))
															void execute({
																type: 'update',
																clipId: chosen.id,
																values: {[key]: e.target.valueAsNumber},
															});
													}}
												/>
											</label>
										))}
										<button
											className="wide-action"
											onClick={() =>
												void execute({type: 'duplicate', clipId: chosen.id})
											}
										>
											<Copy size={14} />
											Duplicar no espaço seguinte
										</button>
										{selectedAsset?.kind === 'video' &&
											selectedAsset.hasAudio &&
											!chosen.linkId && (
												<button
													className="wide-action"
													onClick={() =>
														void execute({
															type: 'detach-audio',
															clipId: chosen.id,
														})
													}
												>
													<AudioLines size={14} />
													Separar áudio vinculado
												</button>
											)}
										<button
											className="wide-action danger"
											onClick={() =>
												void execute({
													type: 'delete',
													clipId: chosen.id,
													closeGap: false,
												})
											}
										>
											<Trash2 size={14} />
											Remover clipe
										</button>
										<button
											className="wide-action danger"
											onClick={() =>
												void execute({
													type: 'delete',
													clipId: chosen.id,
													closeGap: true,
												})
											}
										>
											<Trash2 size={14} />
											Remover e fechar espaço vazio
										</button>
									</details>
								</>
							) : (
								<div className="inspector-empty">
									<MousePointer2 size={24} />
									<h3>Escolha um clipe</h3>
									<p>
										Propriedades e ações aparecem aqui conforme sua seleção.
									</p>
									<div className="shortcut-tip">
										<kbd>T</kbd>
										<span>Ajustar trecho interno</span>
									</div>
									<div className="shortcut-tip">
										<kbd>,</kbd>
										<span>Descartar antes</span>
									</div>
									<div className="shortcut-tip">
										<kbd>.</kbd>
										<span>Descartar depois</span>
									</div>
								</div>
							)
						) : (
							<div className="agent-panel">
								<div className="agent-intro">
									<Terminal size={20} />
									<h3>Uma timeline. Dois jeitos de editar.</h3>
									<p>
										Agentes usam os mesmos comandos que você. Cole um plano JSON
										e confira antes de aplicar.
									</p>
								</div>
								<button
									className="secondary"
									onClick={() =>
										download(
											{
												revision: snapshot!.revision,
												project,
												selectedClipId: selected,
											},
											'contexto-remotion-ps.json',
										)
									}
								>
									<Download size={14} />
									Exportar contexto
								</button>
								<label className="plan-label">
									Plano de edição
									<textarea
										aria-label="Plano de comandos JSON"
										spellCheck={false}
										value={plan}
										placeholder={
											'[\n  {"type": "split",\n   "clipId": "ID do clipe",\n   "frame": 90}\n]'
										}
										onChange={(e) => {
											setPlan(e.target.value);
											setPlanPreview(null);
										}}
									/>
								</label>
								<button
									className="secondary"
									onClick={inspectPlan}
									disabled={!plan.trim()}
								>
									Verificar plano
								</button>
								{planPreview && (
									<div className="plan-review">
										<CheckCircle2 size={17} />
										<strong>
											{planPreview.commands.length} comando(s) válido(s)
										</strong>
										<p>
											{project.clips.length} →{' '}
											{planPreview.project.clips.length} clipes
											<br />
											{timecode(duration, project.fps)} →{' '}
											{timecode(durationOf(planPreview.project), project.fps)}
										</p>
										<button
											className="primary"
											disabled={
												busy || snapshot!.revision !== planPreview.revision
											}
											onClick={async () => {
												await execute(
													{type: 'batch', commands: planPreview.commands},
													planPreview.revision,
												);
												setPlanPreview(null);
											}}
										>
											Aplicar como uma edição
										</button>
										{snapshot!.revision !== planPreview.revision && (
											<p>O projeto mudou. Verifique o plano novamente.</p>
										)}
									</div>
								)}
								<details>
									<summary>Exemplo para o clipe selecionado</summary>
									<pre>
										{JSON.stringify(
											[
												{
													type: 'slip',
													clipId: selected ?? 'selecione-um-clipe',
													delta: 30,
												},
											],
											null,
											2,
										)}
									</pre>
								</details>
								<p className="help-copy">
									Sem provedor de IA ou API paga. A conexão para agentes e o
									catálogo estão no README do editor.
								</p>
							</div>
						)}
					</aside>
				)}
			</div>
			<section className="timeline" aria-label="Timeline">
				<div className="timeline-toolbar">
					<div className="tool-group">
						<IconButton
							label="Selecionar (V)"
							active={tool === 'select'}
							onClick={() => setTool('select')}
						>
							<MousePointer2 size={16} />
						</IconButton>
						<IconButton
							label="Lâmina (C)"
							active={tool === 'razor'}
							onClick={() => setTool('razor')}
						>
							<Scissors size={16} />
						</IconButton>
						<IconButton
							label="Ajuste interno · Slip (T)"
							active={tool === 'slip'}
							onClick={() => setTool('slip')}
						>
							<MoveHorizontal size={18} />
						</IconButton>
					</div>
					<span className="toolbar-divider" />
					<IconButton
						label={`Desfazer${snapshot?.undoLabel ? ': ' + snapshot.undoLabel : ''} (⌘ Z)`}
						onClick={() => void history('undo')}
						disabled={!snapshot?.undoLabel || busy}
					>
						<Undo2 size={16} />
					</IconButton>
					<IconButton
						label="Refazer (⌘ ⇧ Z)"
						onClick={() => void history('redo')}
						disabled={!snapshot?.redoLabel || busy}
					>
						<Redo2 size={16} />
					</IconButton>
					<span className="toolbar-divider" />
					<button
						className="text-button"
						disabled={!commandTarget || busy}
						onClick={() => cut()}
					>
						<Scissors size={14} />
						<span>Cortar</span>
						<kbd>⌘ B</kbd>
					</button>
					<button
						className="text-button trim-action"
						disabled={!commandTarget || busy}
						onClick={() => cut('before')}
					>
						Antes<kbd>,</kbd>
					</button>
					<button
						className="text-button trim-action"
						disabled={!commandTarget || busy}
						onClick={() => cut('after')}
					>
						Depois<kbd>.</kbd>
					</button>
					<div className="toolbar-right">
						<IconButton
							label="Encaixe magnético (S)"
							active={snapping}
							onClick={() => setSnapping((x) => !x)}
						>
							<Magnet size={16} />
						</IconButton>
						<IconButton
							label="Prévia de vídeo ao passar o mouse"
							active={videoSkim}
							onClick={() => setVideoSkim((x) => !x)}
						>
							<Eye size={16} />
						</IconButton>
						<IconButton
							data-audio-control
							label={
								audioArmed
									? 'Prévia sonora ao passar o mouse'
									: 'Ativar prévia sonora'
							}
							active={audioSkim && audioArmed}
							onClick={() => {
								audio.failed.clear();
								if (!audioArmed) {
									void arm();
									setAudioSkim(true);
								} else setAudioSkim((x) => !x);
							}}
						>
							{audioSkim ? <Volume2 size={16} /> : <VolumeX size={16} />}
						</IconButton>
						<details className="editing-options">
							<summary aria-label="Mais opções de edição">
								<MoreHorizontal size={17} />
							</summary>
							<div className="menu">
								<button onClick={() => setSwapOnDrop((x) => !x)}>
									{swapOnDrop ? (
										<Check size={14} />
									) : (
										<MoveHorizontal size={14} />
									)}
									Trocar clipes ao arrastar
								</button>
								<p>
									Desative para mover somente para espaços livres. Sobreposições
									são recusadas.
								</p>
							</div>
						</details>
						<span className="toolbar-divider" />
						<IconButton
							label="Diminuir zoom (⌘ −)"
							onClick={() => setZoom((z) => Math.max(15, z - 20))}
						>
							<ZoomOut size={15} />
						</IconButton>
						<input
							className="zoom-range"
							aria-label="Zoom da timeline"
							type="range"
							min="15"
							max="240"
							value={zoom}
							onChange={(e) => setZoom(Number(e.target.value))}
						/>
						<IconButton
							label="Aumentar zoom (⌘ +)"
							onClick={() => setZoom((z) => Math.min(240, z + 20))}
						>
							<ZoomIn size={15} />
						</IconButton>
					</div>
				</div>
				<div className="timeline-body">
					<div className="track-headers">
						<div className="track-label-heading">
							<span>Faixas</span>
							<details className="track-menu">
								<summary aria-label="Adicionar faixa">
									<Plus size={15} />
								</summary>
								<div className="menu">
									<button
										onClick={() =>
											void execute({type: 'new-track', kind: 'video'})
										}
									>
										<Video size={14} />
										Adicionar faixa de vídeo
									</button>
									<button
										onClick={() =>
											void execute({type: 'new-track', kind: 'audio'})
										}
									>
										<AudioLines size={14} />
										Adicionar faixa de áudio
									</button>
								</div>
							</details>
						</div>
						{project.tracks.map((t) => (
							<div className={`track-header ${t.kind}`} key={t.id}>
								<span>
									{t.kind === 'audio' ? (
										<AudioLines size={15} />
									) : (
										<Video size={15} />
									)}
								</span>
								<span title={t.name}>{t.name}</span>
								<IconButton
									label={`${t.muted ? 'Ativar' : 'Silenciar'} ${t.name}`}
									active={t.muted}
									onClick={() =>
										void execute({
											type: 'track',
											trackId: t.id,
											values: {muted: !t.muted},
										})
									}
								>
									{t.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
								</IconButton>
								<IconButton
									label={`${t.locked ? 'Desbloquear' : 'Bloquear'} ${t.name}`}
									active={t.locked}
									onClick={() =>
										void execute({
											type: 'track',
											trackId: t.id,
											values: {locked: !t.locked},
										})
									}
								>
									{t.locked ? (
										<LockKeyhole size={12} />
									) : (
										<UnlockKeyhole size={12} />
									)}
								</IconButton>
							</div>
						))}
					</div>
					<div
						className={`timeline-scroll tool-${tool}`}
						ref={timeline}
						onPointerLeave={() => {
							if (!gesture.current) clearHover();
						}}
					>
						<div
							className="time-content"
							style={{
								width: Math.max(contentWidth, 600),
								minHeight: project.tracks.length * 78 + 32,
							}}
							onPointerMove={onHover}
							onPointerDown={(e) => {
								if (
									e.target === e.currentTarget ||
									!(e.target as HTMLElement).closest('[data-clip]')
								) {
									player.current?.pause();
									clearHover(false);
									const rect = e.currentTarget.getBoundingClientRect();
									seek((e.clientX - rect.left) / ppf);
									setSelected(null);
								}
							}}
						>
							<div className="ruler">
								{Array.from(
									{length: Math.ceil(totalFrames / project.fps / tickSeconds)},
									(_, i) => (
										<span key={i} style={{left: i * tickSeconds * zoom}}>
											{timecode(
												i * tickSeconds * project.fps,
												project.fps,
											).slice(0, 5)}
										</span>
									),
								)}
							</div>
							{visibleProject.tracks.map((t) => (
								<div
									className={`track-row ${t.kind} ${t.locked ? 'locked' : ''}`}
									data-track={t.id}
									key={t.id}
									onDragOver={(e) => e.preventDefault()}
									onDrop={(e) => {
										e.preventDefault();
										const assetId = e.dataTransfer.getData(
											'application/remotion-ps',
										);
										const a = project.assets.find((x) => x.id === assetId);
										if (!a) return;
										const rect = e.currentTarget.getBoundingClientRect();
										void execute({
											type: 'add',
											assetId: a.id,
											trackId: t.id,
											from: Math.max(
												0,
												Math.round((e.clientX - rect.left) / ppf),
											),
											sourceIn: 0,
											duration:
												a.kind === 'image' ? project.fps * 5 : a.duration,
										});
									}}
								>
									{visibleProject.clips
										.filter((c) => c.trackId === t.id)
										.map((c) => {
											const a = project.assets.find((x) => x.id === c.assetId)!;
											const selectedGroup = chosen
												? groupOf(project, chosen).some((x) => x.id === c.id)
												: false;
											return (
												<div
													key={c.id}
													data-clip={c.id}
													data-testid={`clip-${c.id}`}
													role="button"
													tabIndex={0}
													aria-label={`${c.name}, ${timecode(c.duration, project.fps)}`}
													aria-pressed={selectedGroup}
													className={`timeline-clip ${t.kind} ${selectedGroup ? 'selected' : ''} ${t.muted ? 'muted-clip' : ''}`}
													style={{
														left: c.from * ppf,
														width: Math.max(3, c.duration * ppf),
													}}
													onPointerDown={(e) => begin(e, c, null)}
													onPointerMove={drag}
													onPointerUp={(e) => void finish(e)}
													onPointerCancel={cancelGesture}
													onLostPointerCapture={() => {
														if (gesture.current?.clip.id === c.id)
															cancelGesture();
													}}
													onFocus={() => setSelected(c.id)}
													onKeyDown={(e) => {
														if (e.key === 'Enter') {
															e.preventDefault();
															setSelected(c.id);
															seek(c.from);
														}
													}}
												>
													<div className="clip-label">
														{c.linkId && <Link2 size={10} />}
														<span>{c.name}</span>
													</div>
													<div className="clip-content">
														{t.kind === 'audio' ? (
															<Wave
																peaks={a.peaks}
																start={c.sourceIn / a.duration}
																fraction={c.duration / a.duration}
															/>
														) : a.kind === 'image' ? (
															<img src={a.src} alt="" draggable={false} />
														) : (
															<div
																className="clip-filmstrip"
																style={{
																	backgroundImage: `url(/media/${a.id}.jpg)`,
																}}
															/>
														)}
													</div>
													{t.kind === 'video' && a.hasAudio && c.volume > 0 && (
														<div className="clip-mini-wave">
															<Wave
																peaks={a.peaks}
																start={c.sourceIn / a.duration}
																fraction={c.duration / a.duration}
															/>
														</div>
													)}
													<div
														className="trim-handle left"
														role="separator"
														aria-label="Ajustar início"
														onPointerDown={(e) => begin(e, c, 'start')}
													/>
													<div
														className="trim-handle right"
														role="separator"
														aria-label="Ajustar fim"
														onPointerDown={(e) => begin(e, c, 'end')}
													/>
													{tool === 'slip' && selectedGroup && (
														<div
															className="slip-window"
															title={`Original: ${timecode(c.sourceIn, project.fps)} de ${timecode(a.duration, project.fps)}`}
														>
															<span
																style={{
																	left: `${(c.sourceIn / a.duration) * 100}%`,
																	width: `${(c.duration / a.duration) * 100}%`,
																}}
															/>
														</div>
													)}
												</div>
											);
										})}
								</div>
							))}
							<div
								className="playhead"
								style={{left: frame * ppf}}
								data-testid="playhead"
							>
								<span />
							</div>
							{hover && videoSkim && !playing && !gesture.current && (
								<div
									className="skimmer"
									style={{left: hover.frame * ppf}}
									data-testid="skimmer"
								>
									<span>{timecode(hover.frame, project.fps)}</span>
								</div>
							)}
						</div>
					</div>
				</div>
			</section>
			<footer className="status-bar">
				<span>{gestureHint ?? notice}</span>
				<span>
					{tool === 'slip'
						? 'T · Arraste para ajustar o trecho'
						: tool === 'razor'
							? 'C · Clique para cortar'
							: 'V · Seleção'}
					<span className="dot" />
					{project.clips.length} clipes
					<span className="dot" />
					{timecode(duration, project.fps)}
				</span>
			</footer>
			{error && (
				<div className="toast error" role="alert">
					<AlertCircle size={17} />
					<span>{error}</span>
					<IconButton label="Fechar aviso" onClick={() => setError(null)}>
						<X size={14} />
					</IconButton>
				</div>
			)}
			{renderProgress && (
				<div className="export-status" role="status">
					<div>
						<Download size={18} />
						<strong>{renderProgress.message}</strong>
						<IconButton
							label={
								renderProgress.url ? 'Fechar exportação' : 'Cancelar exportação'
							}
							onClick={() => {
								renderAbort.current?.abort();
								setRenderProgress(null);
							}}
						>
							<X size={15} />
						</IconButton>
					</div>
					<progress value={renderProgress.value} max={1} />
					{renderProgress.url ? (
						<a className="primary" href={renderProgress.url} download>
							Baixar MP4
						</a>
					) : (
						<span>
							{Math.round(renderProgress.value * 100)}% · renderização neste Mac
						</span>
					)}
				</div>
			)}
			{showHelp && <Help close={() => setShowHelp(false)} />}
		</div>
	);
}
function Wave({
	peaks,
	start,
	fraction,
}: {
	peaks: number[];
	start: number;
	fraction: number;
}) {
	if (!peaks.length) return <span className="wave-empty">Áudio</span>;
	const values = Array.from(
		{length: 80},
		(_, i) =>
			peaks[
				Math.min(
					peaks.length - 1,
					Math.max(0, Math.floor((start + (i / 80) * fraction) * peaks.length)),
				)
			] ?? 0,
	);
	return (
		<svg
			className="wave"
			viewBox="0 0 400 44"
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			{values.map((value, i) => (
				<line
					key={i}
					x1={i * 5 + 2}
					x2={i * 5 + 2}
					y1={22 - Math.max(1, value * 20)}
					y2={22 + Math.max(1, value * 20)}
					stroke="currentColor"
					strokeWidth="2"
				/>
			))}
		</svg>
	);
}
function Help({close}: {close: () => void}) {
	const ref = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		ref.current?.showModal();
	}, []);
	return (
		<dialog
			ref={ref}
			className="help-dialog"
			onCancel={close}
			onClick={(e) => {
				if (e.target === e.currentTarget) close();
			}}
		>
			<div className="dialog-heading">
				<h2>Edite no seu ritmo.</h2>
				<IconButton label="Fechar atalhos" onClick={close}>
					<X size={18} />
				</IconButton>
			</div>
			<p>
				O cursor laranja explora. O azul guarda o ponto de reprodução.
				<br />
				Ao sair da timeline, a prévia volta ao ponto guardado.
			</p>
			<div className="shortcut-list">
				{[
					['V', 'Seleção e movimento'],
					['C', 'Lâmina: clique para cortar'],
					['T', 'Ajuste interno: arraste o trecho'],
					['⌘ B', 'Cortar no cursor'],
					[',', 'Descartar antes do cursor'],
					['.', 'Descartar depois do cursor'],
					['Espaço', 'Reproduzir / pausar'],
					['⌘ Z', 'Desfazer'],
					['⌘ ⇧ Z', 'Refazer'],
					['⌫', 'Remover clipe'],
					['⇧ ⌫', 'Remover e fechar espaço vazio'],
					['← / →', 'Voltar / avançar um frame'],
					['⌘ − / +', 'Zoom da timeline'],
					['Esc', 'Cancelar um arraste'],
				].map(([k, v]) => (
					<div key={k}>
						<span>{v}</span>
						<kbd>{k}</kbd>
					</div>
				))}
			</div>
			<p className="help-copy">
				Os atalhos preservam a digitação nos campos. Cortes usam primeiro o
				clipe sob o cursor; fora da timeline, usam a seleção e o cursor azul.
			</p>
		</dialog>
	);
}

createRoot(document.getElementById('root')!).render(<App />);
