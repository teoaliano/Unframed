import { lazy } from "react";

const load = () => import("./dialFields.tsx");

export const DialScope = lazy(() => load().then((module) => ({ default: module.DialScope })));
export const DialSlider = lazy(() => load().then((module) => ({ default: module.DialSlider })));
export const DialSelect = lazy(() => load().then((module) => ({ default: module.DialSelect })));
export const DialColour = lazy(() => load().then((module) => ({ default: module.DialColour })));
export const DialSegmented = lazy(() => load().then((module) => ({ default: module.DialSegmented })));
export const DialButtons = lazy(() => load().then((module) => ({ default: module.DialButtons })));
export const DialSection = lazy(() => load().then((module) => ({ default: module.DialSection })));
