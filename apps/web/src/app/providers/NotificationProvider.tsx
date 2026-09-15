import Alert from "@mui/material/Alert";
import Slide, { type SlideProps } from "@mui/material/Slide";
import Snackbar from "@mui/material/Snackbar";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type NotificationSeverity = "success" | "info" | "warning" | "error";

export interface NotifyOptions {
  message: string;
  severity?: NotificationSeverity;
  /** ms before auto-dismiss; pass null to require manual dismissal. Defaults to 5000. */
  autoHideDuration?: number | null;
}

interface QueuedNotification extends Required<Omit<NotifyOptions, "autoHideDuration">> {
  id: number;
  autoHideDuration: number | null;
}

interface NotificationContextValue {
  notify: (options: NotifyOptions | string) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

function SlideUpTransition(props: SlideProps) {
  return <Slide {...props} direction="up" />;
}

let nextId = 1;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueuedNotification[]>([]);
  const [current, setCurrent] = useState<QueuedNotification | null>(null);
  const [open, setOpen] = useState(false);

  const notify = useCallback((options: NotifyOptions | string) => {
    const normalized: QueuedNotification =
      typeof options === "string"
        ? { id: nextId++, message: options, severity: "info", autoHideDuration: 5000 }
        : {
            id: nextId++,
            message: options.message,
            severity: options.severity ?? "info",
            autoHideDuration: options.autoHideDuration === undefined ? 5000 : options.autoHideDuration,
          };
    setQueue((prev) => [...prev, normalized]);
  }, []);

  if (!current && queue.length > 0) {
    setCurrent(queue[0]);
    setQueue((prev) => prev.slice(1));
    setOpen(true);
  }

  const handleClose = (_event: unknown, reason?: string) => {
    if (reason === "clickaway") return;
    setOpen(false);
  };

  const handleExited = () => {
    setCurrent(null);
  };

  const value = useMemo<NotificationContextValue>(() => ({ notify }), [notify]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <Snackbar
        key={current?.id}
        open={open}
        autoHideDuration={current?.autoHideDuration ?? null}
        onClose={handleClose}
        TransitionProps={{ onExited: handleExited }}
        TransitionComponent={SlideUpTransition}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        {current ? (
          <Alert onClose={handleClose} severity={current.severity} variant="filled" sx={{ width: "100%" }}>
            {current.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </NotificationContext.Provider>
  );
}

export function useNotify(): NotificationContextValue["notify"] {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotify must be used within a NotificationProvider");
  }
  return context.notify;
}
