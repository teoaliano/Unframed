import { mountButtonGroup, mountColorControl, mountFolder, mountSegmentedControl, mountSelectControl, mountSlider, type ButtonGroupProps, type ColorControlProps, type SegmentedControlProps, type SelectControlProps, type SliderProps } from "dialkit/vanilla";
import "dialkit/vanilla/styles.css";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const scheme = () => (document.documentElement.getAttribute("data-unframed-theme") === "dark" ? "dark" : "light");

export const DialScope = ({ children }: { readonly children: ReactNode }) => {
  const [theme, setTheme] = useState(scheme);
  useEffect(() => {
    const follow = new MutationObserver(() => setTheme(scheme()));
    follow.observe(document.documentElement, { attributes: true, attributeFilter: ["data-unframed-theme"] });
    return () => follow.disconnect();
  }, []);
  return (
    <div className="dialkit-root" data-theme={theme} data-unframed-dial-fields="">
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
};

interface Mounted<P> {
  update(props: P): void;
  destroy(): void;
}

const useMount = <P,>(mount: (host: HTMLElement, props: P) => Mounted<P>, props: P) => {
  const host = useRef<HTMLDivElement>(null);
  const mounted = useRef<Mounted<P>>(undefined);
  const latest = useRef(props);
  latest.current = props;
  useLayoutEffect(() => {
    const element = host.current;
    if (element === null) return;
    mounted.current = mount(element, latest.current);
    return () => {
      mounted.current?.destroy();
      mounted.current = undefined;
      element.replaceChildren();
    };
  }, [mount]);
  useLayoutEffect(() => {
    mounted.current?.update(props);
  });
  return host;
};

export const DialSlider = (props: SliderProps) => <div ref={useMount(mountSlider, props)} />;

export const DialSelect = (props: SelectControlProps) => <div ref={useMount(mountSelectControl, props)} />;

const mountInlineColour = (host: HTMLElement, props: ColorControlProps) => mountColorControl(host, props);

export const DialColour = (props: ColorControlProps) => <div ref={useMount(mountInlineColour, props)} />;

export const DialSegmented = ({ label, ...props }: SegmentedControlProps & { readonly label: string }) => (
  <div className="dialkit-labeled-control">
    <span className="dialkit-labeled-control-label">{label}</span>
    <div ref={useMount(mountSegmentedControl, props as SegmentedControlProps)} />
  </div>
);

export const DialButtons = (props: ButtonGroupProps) => <div ref={useMount(mountButtonGroup, props)} />;

export const DialSection = ({ title, children }: { readonly title: string; readonly children: ReactNode }) => {
  const host = useRef<HTMLDivElement>(null);
  const [body, setBody] = useState<HTMLElement>();
  useLayoutEffect(() => {
    const element = host.current;
    if (element === null) return;
    const folder = mountFolder(element, { title, defaultOpen: true, isSection: true });
    folder.element.setAttribute("role", "group");
    folder.element.setAttribute("aria-label", title);
    setBody(folder.body);
    return () => {
      folder.destroy();
      element.replaceChildren();
    };
  }, [title]);
  return (
    <div ref={host}>
      {body !== undefined && createPortal(<div className="flex flex-col gap-1.5">{children}</div>, body)}
    </div>
  );
};
