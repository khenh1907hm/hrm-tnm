export type CommanderInput = {
  name: string;
  role: string;
  phone: string;
  address: string;
};

export type Commander = CommanderInput & {
  id: string;
  archived: boolean;
  version: number;
};

export const DEMO_COMMANDERS: readonly Commander[] = [
  {
    id: "cmd-1",
    name: "Phạm Văn Sơn",
    role: "Chỉ huy trưởng công trường",
    phone: "0902000111",
    address: "8 đường Mẫu, P. Tân Sơn Nhì, Q. Tân Phú, TP.HCM",
    archived: false,
    version: 1,
  },
  {
    id: "cmd-2",
    name: "Võ Hoàng Kha",
    role: "Chỉ huy trưởng công trường",
    phone: "0903222456",
    address: "8 đường Mẫu, P. Tân Sơn Nhì, Q. Tân Phú, TP.HCM",
    archived: false,
    version: 1,
  },
];
