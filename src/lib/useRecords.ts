import { useState, useEffect, useCallback, useRef } from "react";
import { list, errorMessage } from "./api";
import { useWorkspace } from "../components/AppLayout";
export function useRecords<T>(table: string) {
  const { workspace } = useWorkspace();
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const result = await list<T>(table, workspace.id);
      if (request === sequence.current) setData(result);
    } catch (e) {
      if (request === sequence.current) setError(errorMessage(e));
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [table, workspace.id]);
  useEffect(() => {
    setData([]);
    void reload();
    return () => {
      sequence.current++;
    };
  }, [reload]);
  return { data, loading, error, reload };
}
