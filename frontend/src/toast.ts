import { createContext, useContext } from "react";

export type ToastType = "success" | "info" | "warning" | "error";
export type ShowToast = (message: string, type?: ToastType) => void;

const noopToast: ShowToast = () => {};
export const ToastContext = createContext<ShowToast>(noopToast);

export function useToast(): ShowToast {
  return useContext(ToastContext);
}
