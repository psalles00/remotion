import React from 'react';
import {
	AbsoluteFill,
	Sequence,
	OffthreadVideo,
	Html5Audio,
	Img,
} from 'remotion';
import type {Project} from './model';
export function EditComposition({
	project,
	mediaBase = '',
	silent = false,
}: {
	project: Project;
	mediaBase?: string;
	silent?: boolean;
}) {
	return (
		<AbsoluteFill style={{background: '#000'}}>
			{[...project.tracks].reverse().map((t) =>
				project.clips
					.filter((c) => c.trackId === t.id)
					.map((c) => {
						const a = project.assets.find((x) => x.id === c.assetId);
						if (!a) return null;
						const src = mediaBase + a.src;
						const style: React.CSSProperties = {
							width: '100%',
							height: '100%',
							objectFit: 'contain',
							opacity: c.opacity,
							transform: `translate(${c.x}px,${c.y}px) scale(${c.scale})`,
						};
						return (
							<Sequence
								key={c.id}
								from={c.from}
								durationInFrames={c.duration}
								name={c.name}
							>
								{t.kind === 'audio' ? (
									!silent && !t.muted && a.hasAudio ? (
										<Html5Audio
											src={src}
											trimBefore={c.sourceIn}
											volume={c.volume}
										/>
									) : null
								) : t.muted ? null : a.kind === 'video' ? (
									<OffthreadVideo
										src={src}
										trimBefore={c.sourceIn}
										volume={c.volume}
										muted={silent}
										style={style}
										pauseWhenBuffering
									/>
								) : (
									<Img src={src} style={style} />
								)}
							</Sequence>
						);
					}),
			)}
		</AbsoluteFill>
	);
}
