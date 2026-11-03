'use client';

import { CircleAlertIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { isTranslatedIssue, type Issue } from './validation';

/** Returns a function that words a validation issue in the active locale (API text as a fallback). */
export function useIssueText(): (issue: Issue) => string {
  const t = useTranslations('Composer.issues');

  return (issue) => {
    if (!isTranslatedIssue(issue)) return issue.message;
    // ICU arguments take strings and numbers; shared params may also carry booleans.
    const params: Record<string, string | number> = {};
    for (const [name, value] of Object.entries(issue.params ?? {})) {
      params[name] = typeof value === 'boolean' ? String(value) : value;
    }
    if (issue.code === 'MEDIA_TOO_LARGE' && typeof params.max === 'number') {
      params.max = `${Math.round((params.max / (1024 * 1024)) * 10) / 10} MB`;
    }
    return t(issue.code, params);
  };
}

/** Inline error list for one field. Renders nothing when there are no issues. */
export function FieldIssues({
  issues,
  id,
  className,
}: {
  issues: readonly Issue[] | undefined;
  id?: string;
  className?: string;
}) {
  const describe = useIssueText();
  if (!issues || issues.length === 0) return null;

  return (
    <ul id={id} role="alert" className={className ?? 'flex flex-col gap-1'}>
      {issues.map((issue, index) => (
        <li
          key={`${issue.code}-${index}`}
          className="flex items-start gap-1.5 text-xs font-medium text-destructive"
        >
          <CircleAlertIcon className="mt-px size-3.5 shrink-0" />
          {describe(issue)}
        </li>
      ))}
    </ul>
  );
}
