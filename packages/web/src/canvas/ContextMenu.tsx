import { parseAssetMarker, UnframedError } from "@unframed/contracts";
import { contextMenu, readRef, type MenuItem, type MenuSection, type MenuShape } from "@unframed/domain";
import { useEffect, useState } from "react";
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
  return {
    id: shape.id,
    type: shape.type,
    ...(ref !== undefined ? { ref } : {}),
    ...(marker?.kind === "project-file" ? { file: marker.file } : {}),
    ...(marker?.kind === "link" ? { link: true } : {}),
    ...(isTextResult(shape) ? { textResult: true } : {}),
    ...(parent?.type === "frame" ? { parent: parent.id } : {}),
    ...(groupRecipeOf(shape) ? { recipe: true } : {}),
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
          <div className="unframed-menu-heading" role="presentation">
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
                className="tlui-button tlui-button__menu unframed-menu-disabled"
                data-testid={`context-menu.unframed-${item.action}`}
              >
                <span className="tlui-button__label">{item.label}</span>
              </div>
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

/**
 * The right-click menu: Unframed's sections, then tldraw's own groups minus its group,
 * ungroup, cut, copy and paste items. tldraw's frame-selection and remove-frame items
 * are its group and ungroup for frames, which are Unframed's groups, so they go too.
 */
export const ContextMenu = (props: TLUiContextMenuProps) => (
  <DefaultContextMenu {...props}>
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
