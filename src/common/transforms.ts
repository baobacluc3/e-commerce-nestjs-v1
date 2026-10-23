// Small helpers for `@Transform()` in DTOs. They run before validation.

// " Jane@Example.COM " becomes "jane@example.com".
export const trimAndLowercase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
