import { useState, useEffect, useCallback } from "react";
import { list, errorMessage } from "./api";
import { useWorkspace } from "../components/AppLayout";
export function useRecords<T>(table: string) {
  const { workspace } = useWorkspace();
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await list<T>(table, workspace.id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [table, workspace.id]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, loading, error, reload };
}
