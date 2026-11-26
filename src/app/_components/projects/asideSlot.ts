"use client";
import { createContext } from "react";

/** Ô trống đầu khung bên phải (trên Người duyệt) của tab dự án: trang con đưa chuỗi ký vào đây bằng portal. */
export const AsideSlotContext = createContext<HTMLElement | null>(null);
