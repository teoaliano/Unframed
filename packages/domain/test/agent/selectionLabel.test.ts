import { describe, expect, it } from "vitest";
import { describeTool } from "../../src/index.ts";

const described = (shapeIds: unknown) =>
  describeTool({ toolName: "mcp__unframed__canvas_select", itemType: "mcp_tool_call", toolInput: { shapeIds }, data: {}, result: {}, state: "completed" as never });

describe("the work log row of canvas_select", () => {
  it("says how many shapes were selected, and that Revert leaves a selection alone", () => {
    expect(described(["a", "b", "c"]).label).toBe("Selected 3 shapes. Revert does not undo a selection.");
    expect(described(["a"]).label).toBe("Selected 1 shape. Revert does not undo a selection.");
  });

  it("says the selection was cleared when the list is empty", () => {
    expect(described([]).label).toBe("Cleared the selection. Revert does not undo a selection.");
  });
});
