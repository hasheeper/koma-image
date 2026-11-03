import { version } from "../../package.json";
import changelog from "../../CHANGELOG.md?raw";
import { parseChangelog } from "../domain/changelog";

export const appVersion = version;
export const releaseNotes = parseChangelog(changelog);
