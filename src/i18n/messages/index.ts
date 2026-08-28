import type { Locale } from "../config";
import { en } from "./en";
import { tr } from "./tr";

export const messages = { en, tr } satisfies Record<Locale, typeof en>;
