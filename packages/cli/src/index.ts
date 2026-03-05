#!/usr/bin/env node

import { Command } from "commander";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { runCommand } from "./commands/run.js";
import { listCommand } from "./commands/list.js";
import { daemonCommand } from "./commands/daemon.js";
import { orgCommand } from "./commands/org.js";

const program = new Command()
  .name("anyterm")
  .description("E2E encrypted remote terminal streaming")
  .version("0.1.0");

program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(runCommand);
program.addCommand(listCommand);
program.addCommand(daemonCommand);
program.addCommand(orgCommand);

program.parse();
