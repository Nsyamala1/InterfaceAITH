// ---------------------------------------------------------------------------
// Tool definitions for the discovery agent loop. Deliberately the same
// closed action vocabulary as ArtifactAction (schema.ts) plus two
// loop-control tools ("done", "stuck") that never appear in a replayed
// artifact. Keeping the vocabularies aligned is what makes "convert the
// transcript into steps" a straightforward mechanical translation instead of
// a second interpretation layer.
// ---------------------------------------------------------------------------

export const tools = [
  {
    name: "click",
    description: "Click an interactive element from the current observation by its index.",
    input_schema: {
      type: "object",
      properties: {
        index: { type: "number", description: "Index from the interactive elements list." },
        reasoning: { type: "string", description: "Why this click moves toward the goal." },
      },
      required: ["index", "reasoning"],
    },
  },
  {
    name: "type",
    description: "Type text into an input/textarea element by its index.",
    input_schema: {
      type: "object",
      properties: {
        index: { type: "number" },
        value: { type: "string" },
        isParam: {
          type: "boolean",
          description: "True if this value should become a reusable input parameter of the resulting capability (e.g. a member ID), rather than a hardcoded literal.",
        },
        paramName: { type: "string", description: "Parameter name, required if isParam is true." },
        reasoning: { type: "string" },
      },
      required: ["index", "value", "isParam", "reasoning"],
    },
  },
  {
    name: "select",
    description: "Choose an option in a <select> element by its index.",
    input_schema: {
      type: "object",
      properties: {
        index: { type: "number" },
        value: { type: "string", description: "The option's value attribute." },
        isParam: { type: "boolean" },
        paramName: { type: "string" },
        reasoning: { type: "string" },
      },
      required: ["index", "value", "isParam", "reasoning"],
    },
  },
  {
    name: "navigate",
    description: "Navigate directly to a URL (path relative to the target base URL is fine).",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string" },
        reasoning: { type: "string" },
      },
      required: ["url", "reasoning"],
    },
  },
  {
    name: "extract",
    description: "Read the text content of an element by index and record it as a named output of the resulting capability.",
    input_schema: {
      type: "object",
      properties: {
        index: { type: "number" },
        outputName: { type: "string", description: "snake_case name for this output, e.g. savings_balance." },
        outputDescription: { type: "string" },
        reasoning: { type: "string" },
      },
      required: ["index", "outputName", "outputDescription", "reasoning"],
    },
  },
  {
    name: "done",
    description: "Declare the goal achieved. Only call this once the page visibly shows the completed outcome.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        successCheckpointDescription: {
          type: "string",
          description: "A concrete, checkable description of the state that proves success (e.g. \"URL matches /members/:id and page shows the savings balance cell\").",
        },
      },
      required: ["summary", "successCheckpointDescription"],
    },
  },
  {
    name: "stuck",
    description: "Declare that you cannot safely proceed (ambiguous page state, unexpected error, action would be outside policy) and need a human.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
] as const;

export type ToolName = (typeof tools)[number]["name"];
