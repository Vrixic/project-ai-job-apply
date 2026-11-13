/** The grounded paragraphs shape every cover letter and answer provider must return (ADR-030 decision 4). */
export const GROUNDED_PARAGRAPHS_NAME = "grounded_paragraphs_v1";

export const GROUNDED_PARAGRAPHS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["paragraphs"],
  properties: {
    paragraphs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "factIds"],
        properties: {
          text: { type: "string" },
          factIds: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;
