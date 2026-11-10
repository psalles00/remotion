import React from 'react';
import {registerRoot, Composition} from 'remotion';
import {EditComposition} from './Composition';
import {emptyProject, durationOf, type Project} from './model';
const Root = () => (
	<Composition
		id="RemotionPS"
		component={EditComposition}
		durationInFrames={1}
		fps={30}
		width={1920}
		height={1080}
		defaultProps={{project: emptyProject(), mediaBase: '', silent: false}}
		calculateMetadata={({props}) => ({
			durationInFrames: durationOf(props.project as Project),
			fps: props.project.fps,
			width: props.project.width,
			height: props.project.height,
		})}
	/>
);
registerRoot(Root);
