export type Issue = {
  code: string;
  field?: string;
  params?: Record<string, string | number>;
  severity: "error" | "warning";
};

export type Result<T> =
  | { ok: true; value: T; warnings: Issue[] }
  | { ok: false; errors: Issue[]; warnings: Issue[] };

export function success<T>(value: T, warnings: Issue[] = []): Result<T> {
  return { ok: true, value, warnings };
}

export function failure<T = never>(errors: Issue[], warnings: Issue[] = []): Result<T> {
  return { ok: false, errors, warnings };
}

export function issue(code: string, field?: string, severity: Issue["severity"] = "error", params?: Issue["params"]): Issue {
  return { code, ...(field === undefined ? {} : { field }), ...(params === undefined ? {} : { params }), severity };
}
