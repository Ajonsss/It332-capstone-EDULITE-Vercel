import { useEffect } from "react";

export function usePageTitle(page, enabled = true) {
  useEffect(() => {
    if (enabled) document.title = `${page} | EduLITE`;
  }, [page, enabled]);
}
