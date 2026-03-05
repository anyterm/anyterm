import { builder } from "./builder";

import "./types/user-keys";
import "./types/terminal-session";
import "./types/terminal-chunk";
import "./types/org-keys";
import "./types/activity-log";
import "./types/sso-provider";

import "./resolvers/user-keys";
import "./resolvers/user";
import "./resolvers/setup-keys";
import "./resolvers/sessions";
import "./resolvers/chunks";
import "./resolvers/plan";
import "./resolvers/org-keys";
import "./resolvers/activity-logs";
import "./resolvers/sso";

export const schema = builder.toSchema();
