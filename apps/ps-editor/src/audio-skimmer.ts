import type {Project} from './model';

// 6 × 10 s × 16 kHz mono ≈ 3.84 MB decoded. At most two requests in flight.
export class AudioSkimmer {
	context: AudioContext | null = null;
	token = '';
	onError: ((message: string) => void) | null = null;
	failed = new Set<string>();
	cache = new Map<string, AudioBuffer>();
	pending = new Map<string, Promise<void>>();
	nodes: AudioBufferSourceNode[] = [];
	latest: {project: Project; frame: number} | null = null;
	lastTime = 0;
	async arm() {
		this.context ??= new AudioContext({sampleRate: 16000});
		await this.context.resume();
	}
	stop() {
		this.latest = null;
		for (const n of this.nodes) {
			try {
				n.stop();
			} catch {}
		}
		this.nodes = [];
	}
	async audition(project: Project, frame: number) {
		this.latest = {project, frame};
		if (
			!this.context ||
			this.context.state !== 'running' ||
			performance.now() - this.lastTime < 70
		)
			return;
		this.lastTime = performance.now();
		const active = project.clips
			.filter(
				(c) =>
					c.from <= frame &&
					c.from + c.duration > frame &&
					c.volume > 0 &&
					!project.tracks.find((t) => t.id === c.trackId)?.muted,
			)
			.slice(0, 8);
		for (const n of this.nodes) {
			try {
				n.stop();
			} catch {}
		}
		this.nodes = [];
		for (const c of active) {
			const a = project.assets.find((x) => x.id === c.assetId);
			if (!a?.hasAudio) continue;
			const seconds = (c.sourceIn + frame - c.from) / project.fps,
				chunk = Math.floor(seconds / 10),
				key = a.id + ':' + chunk;
			const buffer = this.cache.get(key);
			if (!buffer) {
				if (
					!this.pending.has(key) &&
					!this.failed.has(key) &&
					this.pending.size < 2
				) {
					const request = fetch(`/audio/${a.id}/${chunk}.wav`, {
						headers: {'X-Remotion-PS-Token': this.token},
					})
						.then((r) => {
							if (!r.ok) throw Error('Áudio indisponível');
							return r.arrayBuffer();
						})
						.then((b) => this.context!.decodeAudioData(b))
						.then((b) => {
							this.cache.set(key, b);
							while (this.cache.size > 6)
								this.cache.delete(this.cache.keys().next().value!);
							const latest = this.latest;
							if (latest) {
								this.lastTime = 0;
								void this.audition(latest.project, latest.frame);
							}
						})
						.catch(() => {
							this.failed.add(key);
							this.onError?.(
								`A prévia sonora de ${a.name} não está disponível. Desative e reative o som para tentar novamente.`,
							);
						})
						.finally(() => this.pending.delete(key));
					this.pending.set(key, request);
				}
				continue;
			}
			this.cache.delete(key);
			this.cache.set(key, buffer);
			const offset = seconds - chunk * 10,
				length = Math.min(0.09, buffer.duration - offset);
			if (length <= 0) continue;
			const node = this.context.createBufferSource(),
				gain = this.context.createGain();
			node.buffer = buffer;
			const now = this.context.currentTime;
			gain.gain.setValueAtTime(0, now);
			gain.gain.linearRampToValueAtTime(c.volume * 0.65, now + 0.006);
			gain.gain.setValueAtTime(
				c.volume * 0.65,
				now + Math.max(0.006, length - 0.012),
			);
			gain.gain.linearRampToValueAtTime(0, now + length);
			node.connect(gain);
			gain.connect(this.context.destination);
			node.start(now, offset, length);
			this.nodes.push(node);
		}
	}
}
