// Compact spec table for an MCP tool or CLI command. Rendered from MDX:
//
//   <ToolSpec
//     name="search_documents"
//     summary="Hybrid pgvector + FTS search."
//     params={[
//       { name: "query", type: "string", required: true, description: "..." },
//       { name: "space_slug", type: "string", description: "..." },
//     ]}
//     returns="Markdown block with up to N ranked chunks (preview + ids)."
//   />

import type { ReactNode } from "react";

export type ToolSpecParam = {
  name: string;
  type: string;
  required?: boolean;
  default?: string | number | boolean;
  description: string;
};

export type ToolSpecProps = {
  name: string;
  summary: ReactNode;
  params?: ToolSpecParam[];
  returns?: ReactNode;
  errors?: Array<{ when: string; message: string }>;
  example?: ReactNode;
};

export function ToolSpec({
  name,
  summary,
  params,
  returns,
  errors,
  example,
}: ToolSpecProps) {
  return (
    <div className="not-prose my-6 rounded-lg border border-fd-border bg-fd-card text-fd-card-foreground">
      <div className="border-b border-fd-border px-4 py-3">
        <code className="font-mono text-sm font-semibold">{name}</code>
        <p className="mt-1 text-sm text-fd-muted-foreground">{summary}</p>
      </div>

      {params && params.length > 0 && (
        <Section title="Parameters">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-fd-muted-foreground">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Default</th>
                <th className="px-4 py-2">Description</th>
              </tr>
            </thead>
            <tbody>
              {params.map((p) => (
                <tr
                  key={p.name}
                  className="border-t border-fd-border align-top"
                >
                  <td className="px-4 py-2 font-mono">
                    {p.name}
                    {p.required && (
                      <span
                        className="ml-1 text-fd-primary"
                        aria-label="required"
                      >
                        *
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-fd-muted-foreground">
                    {p.type}
                  </td>
                  <td className="px-4 py-2 font-mono text-fd-muted-foreground">
                    {p.default === undefined ? "—" : String(p.default)}
                  </td>
                  <td className="px-4 py-2">{p.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {returns && <Section title="Returns">{returns}</Section>}

      {errors && errors.length > 0 && (
        <Section title="Errors">
          <ul className="space-y-1 text-sm">
            {errors.map((e, i) => (
              <li key={i}>
                <span className="font-mono text-fd-muted-foreground">
                  {e.when}
                </span>{" "}
                — {e.message}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {example && <Section title="Example">{example}</Section>}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-fd-border last:border-b-0">
      <div className="bg-fd-muted/30 px-4 py-1.5 text-xs uppercase tracking-wide text-fd-muted-foreground">
        {title}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}
