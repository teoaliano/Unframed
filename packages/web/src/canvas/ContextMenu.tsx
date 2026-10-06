import { parseAssetMarker, UnframedError } from "@unframed/contracts";
import { contextMenu, isArtifactKind, readRef, type MenuItem, type MenuSection, type MenuShape } from "@unframed/domain";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrangeMenuSubmenu,
  ConversionsMenuGroup,
  DefaultContextMenu,
  DeleteMenuItem,
  DuplicateMenuItem,
  EditLinkMenuItem,
  FitFrameToContentMenuItem,
  ReorderMenuSubmenu,
  SelectAllMenuItem,
  TldrawUiMenuActionItem,
  TldrawUiMenuCheckboxItem,
  TldrawUiMenuGroup,
  TldrawUiMenuItem,
  TldrawUiMenuSubmenu,
  ToggleLockMenuItem,
  useActions,
  useEditor,
  useValue,
  type Editor,
  type TLAssetId,
  type TLShape,
  type TLShapeId,
  type TLUiContextMenuProps,
  type VecLike,
} from "tldraw";
import { currentSlots } from "../chrome/slots.ts";
import { copyAsPrompt } from "../generate/copyAsPrompt.ts";
import { isTextResult } from "../generate/facts.ts";
import { useActivation, useEngine } from "../context.ts";
import { useActiveProject } from "../project/activation.ts";
import { showError } from "../toasts.tsx";
import { addShape, kindOfAddAction } from "./addShapes.ts";
import { imagePng } from "./externalContent.ts";
import { groupRecipeOf, setGroupRecipe } from "./groupRecipes.ts";
import { ungroup, wrapSelection } from "./groups.ts";
import { platform } from "./platform.ts";
import { pinnedAtom, togglePin } from "../artifacts/state.ts";

const messageOf = (error: unknown) => (error instanceof UnframedError || error instanceof Error ? error.message : String(error));

const assetSrc = (editor: Editor, shape: TLShape): string | undefined => {
  const assetId = (shape.props as { assetId?: string | null }).assetId;
  const asset = assetId ? editor.getAsset(assetId as TLAssetId) : undefined;
  return (asset?.props as { src?: string | null } | undefined)?.src ?? undefined;
};

/** What the menu rules need to know about a shape. */
const menuShape = (editor: Editor, shape: TLShape): MenuShape => {
  const marker = shape.type === "image" || shape.type === "video" ? parseAssetMarker(assetSrc(editor, shape) ?? "") : undefined;
  const ref = readRef(shape);
  const parent = editor.getShape(shape.parentId as TLShapeId);
  const artifactFile = isArtifactKind(shape.type) ? (shape.props as { file?: string }).file : undefined;
  return {
    id: shape.id,
    type: shape.type,
    ...(ref !== undefined ? { ref } : {}),
    ...(marker?.kind === "project-file" ? { file: marker.file } : artifactFile ? { file: artifactFile } : {}),
    ...(marker?.kind === "link" ? { link: true } : {}),
    ...(isTextResult(shape) ? { textResult: true } : {}),
    ...(parent?.type === "frame" ? { parent: parent.id } : {}),
    ...(groupRecipeOf(shape) ? { recipe: true } : {}),
    ...(artifactFile ? { filledArtifact: true } : {}),
  };
};

/** The shape under a right-click. A group counts only by its label or edge, as tldraw hits a frame. */
const shapeUnder = (editor: Editor, point: VecLike): TLShape | undefined =>
  editor.getShapeAtPoint(point, { margin: 4 / editor.getZoomLevel(), hitInside: true, hitLabels: true, renderingOnly: true });

/**
 * Whether Paste would do something. A clipboard the page may not read without asking
 * counts as empty: reading it here would put a permission prompt on every right-click.
 */
const clipboardHasContent = async (): Promise<boolean> => {
  try {
    const status = await navigator.permissions.query({ name: "clipboard-read" as PermissionName });
    if (status.state !== "granted") return false;
    const items = await navigator.clipboard.read();
    return items.some((item) => item.types.some((type) => type === "text/plain" || type === "text/html" || type.startsWith("image/") || type.startsWith("video/")));
  } catch {
    return false;
  }
};

interface Opened {
  readonly point: VecLike;
  readonly clicked: TLShape | undefined;
  readonly selection: ReadonlyArray<TLShape>;
}

const UnframedSections = () => {
  const editor = useEditor();
  const engine = useEngine();
  const project = useActiveProject(useActivation()) ?? "";
  const actions = useActions();
  const [opened] = useState<Opened>(() => {
    const point = editor.inputs.getCurrentPagePoint().clone();
    return { point, clicked: shapeUnder(editor, point), selection: editor.getSelectedShapes() };
  });
  const [clipboard, setClipboard] = useState(false);
  useEffect(() => {
    let live = true;
    void clipboardHasContent().then((has) => live && setClipboard(has));
    return () => {
      live = false;
    };
  }, []);

  const sections: MenuSection[] = contextMenu({
    target: opened.clicked ? { kind: "shape", shape: menuShape(editor, opened.clicked) } : { kind: "canvas" },
    selection: opened.selection.map((shape) => menuShape(editor, shape)),
    clipboard,
    libraryRegistered: currentSlots().addToLibrary !== undefined,
    platform: platform(),
    pinned: pinnedAtom(project).get(),
  });

  const selectClickedWhenEmpty = () => {
    if (editor.getSelectedShapeIds().length === 0 && opened.clicked) editor.select(opened.clicked.id);
  };

  const run = (item: MenuItem) => {
    switch (item.action) {
      case "reveal": {
        const count = item.files.length;
        engine.call("files.reveal", { project, fileNames: [...item.files] }).catch((error: unknown) => {
          showError(count > 1 ? `Could not show those ${count} files: ${messageOf(error)}` : `Could not show that file: ${messageOf(error)}`);
        });
        return;
      }
      case "copy-path":
        engine.call("files.path", { project, fileName: item.file }).then(
          ({ path }) => navigator.clipboard.writeText(path).catch(() => showError("Could not copy that path to the clipboard.")),
          (error: unknown) => showError(`Could not copy that path: ${messageOf(error)}`),
        );
        return;
      case "copy-as-image": {
        const png = opened.clicked ? imagePng(editor, project, opened.clicked) : undefined;
        const failed = () => showError("Could not copy that image to the clipboard.");
        if (!png) return failed();
        png.catch(() => undefined);
        navigator.clipboard.write([new ClipboardItem({ "image/png": png })]).catch(failed);
        return;
      }
      case "copy-ref":
        navigator.clipboard.writeText(`@${item.ref}`).catch(() => showError(`Could not copy @${item.ref} to the clipboard.`));
        return;
      case "copy-as-prompt":
        if (opened.clicked) copyAsPrompt(editor, opened.clicked);
        return;
      case "cut":
      case "copy":
        selectClickedWhenEmpty();
        actions[item.action]?.onSelect("context-menu");
        return;
      case "paste":
        actions.paste?.onSelect("context-menu");
        return;
      case "group":
        wrapSelection(editor);
        return;
      case "ungroup": {
        const selectedGroups = editor.getSelectedShapes().filter((shape) => shape.type === "frame");
        ungroup(editor, selectedGroups.length > 0 ? selectedGroups.map((shape) => shape.id) : opened.clicked ? [opened.clicked.id] : []);
        return;
      }
      case "clear-recipe":
        if (opened.clicked) setGroupRecipe(editor, opened.clicked.id, undefined);
        return;
      case "keep-playing":
        if (opened.clicked) togglePin(project, opened.clicked.id);
        return;
      case "add-to-library":
        selectClickedWhenEmpty();
        currentSlots().addToLibrary?.(editor);
        return;
      default:
        addShape(editor, kindOfAddAction(item.action), { at: opened.point });
    }
  };

  return (
    <>
      {sections.map((section) => (
        <TldrawUiMenuGroup key={section.section} id={`unframed-${section.section}`}>
          {/* tldraw's menu is not a kit Menu, so the heading carries the kit's menu label recipe itself. */}
          <div data-testid="context-menu-heading" role="presentation" className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            {section.heading}
          </div>
          {section.items.map((item) =>
            "disabled" in item && item.disabled ? (
              // tldraw leaves a disabled item out of its context menu; this one stays, greyed, and says why.
              <div
                key={item.action}
                role="menuitem"
                aria-disabled="true"
                data-disabled=""
                title={item.tooltip}
                // oxlint-disable-next-line shadcn/no-unknown-classes -- tldraw's own row classes, so the disabled row lines up with tldraw's rows
                className="tlui-button tlui-button__menu"
                data-testid={`context-menu.unframed-${item.action}`}
              >
                {/* oxlint-disable-next-line shadcn/no-unknown-classes -- tldraw's own label class, as on its rows */}
                <span className="tlui-button__label">{item.label}</span>
              </div>
            ) : item.action === "keep-playing" ? (
              <TldrawUiMenuCheckboxItem key={item.action} id="unframed-keep-playing" label={item.label} checked={item.checked} onSelect={() => void run(item)} />
            ) : (
            <TldrawUiMenuItem
              key={item.action}
              id={`unframed-${item.action}`}
              label={item.label}
              // Wrapped in [[ ]] so tldraw shows the hint exactly as the menu rules spell it.
              {...("shortcut" in item ? { kbd: `[[${item.shortcut}]]` } : {})}
              onSelect={() => {
                run(item);
              }}
            />
            ),
          )}
        </TldrawUiMenuGroup>
      ))}
    </>
  );
};

/** tldraw's Edit submenu without its group and ungroup items, which Unframed's Edit section replaces. */
const TldrawEditSubmenu = () => {
  const editor = useEditor();
  const any = useValue("any selected", () => editor.getSelectedShapeIds().length > 0, [editor]);
  const flatten = useValue(
    "flatten shown",
    () => {
      const only = editor.getOnlySelectedShape();
      return editor.getSelectedShapeIds().length > 0 && !(only && only.type === "image");
    },
    [editor],
  );
  if (!any) return null;
  return (
    <TldrawUiMenuSubmenu id="edit" label="context-menu.edit" size="small">
      {flatten && <TldrawUiMenuActionItem actionId="flatten-to-image" />}
      <EditLinkMenuItem />
      <FitFrameToContentMenuItem />
      <ToggleLockMenuItem />
    </TldrawUiMenuSubmenu>
  );
};

/** The event tldraw's menu library dispatches on a closed menu before it refocuses the canvas. */
const REFOCUS_EVENT = "focusScope.autoFocusOnUnmount";

/**
 * Hands keyboard focus back to the canvas the moment the menu closes. Left alone, the menu
 * library does it on a timer; on a busy page a right-click can open the next menu before
 * that timer runs, and the late focus then lands outside the new menu, which closes at
 * once. So this cancels the timer's refocus and does it synchronously instead.
 */
const FocusHandBack = () => {
  const editor = useEditor();
  const marker = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const content = marker.current?.closest<HTMLElement>("[role='menu']");
    if (!content) return;
    // Left attached: the event fires after the menu has unmounted.
    content.addEventListener(REFOCUS_EVENT, (event) => event.preventDefault());
    return () => {
      const active = content.ownerDocument.activeElement;
      if (active === null || active === content.ownerDocument.body || content.contains(active)) editor.getContainer().focus();
    };
  }, [editor]);
  return <span ref={marker} hidden />;
};

/**
 * The right-click menu: Unframed's sections, then tldraw's own groups minus its group,
 * ungroup, cut, copy and paste items. tldraw's frame-selection and remove-frame items
 * are its group and ungroup for frames, which are Unframed's groups, so they go too.
 */
export const ContextMenu = (props: TLUiContextMenuProps) => (
  <DefaultContextMenu {...props}>
    <FocusHandBack />
    <UnframedSections />
    <TldrawUiMenuGroup id="modify">
      <TldrawEditSubmenu />
      <ArrangeMenuSubmenu />
      <ReorderMenuSubmenu />
    </TldrawUiMenuGroup>
    <TldrawUiMenuGroup id="clipboard">
      <DuplicateMenuItem />
      <DeleteMenuItem />
    </TldrawUiMenuGroup>
    <ConversionsMenuGroup />
    <TldrawUiMenuGroup id="select-all">
      <SelectAllMenuItem />
    </TldrawUiMenuGroup>
  </DefaultContextMenu>
);
