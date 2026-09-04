// Which project this canvas is showing, for everything below App.jsx that has to
// tag a request with it -- the three output nodes' Generate/Run, reveal-in-folder.
//
// `name` is the rendered value; `ref.current` is the live one, for code that runs
// after an await and has to ask "is this STILL the project I started in?" before
// writing a result into node data. That guard used to read a module-level
// `currentProject` in api.js, which was the third copy of the active project and the
// one that drifted (CLAUDE.md, the activate() story). Now there is the React state
// and this context derived from it, and nothing else.
import { createContext, useContext } from 'react';

export const ProjectContext = createContext({ name: 'default', ref: { current: 'default' } });

export const useProject = () => useContext(ProjectContext);
