import HrmClient from "./hrm-client";
import { ToastProvider } from "./_components/Toast";

export default function Home() {
  return (
    <ToastProvider>
      <HrmClient />
    </ToastProvider>
  );
}
