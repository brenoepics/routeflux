import type { Plugin, PluginContext } from "./interfaces";

/**
 * Registers and initializes Routeforge plugins.
 */
export class PluginManager {
  private readonly plugins: Plugin[] = [];

  /**
   * Registers a plugin and returns the manager for chaining.
   *
   * Duplicate plugin names are allowed but emit a warning.
   */
  use(plugin: Plugin): this {
    if (this.plugins.some((registeredPlugin) => registeredPlugin.name === plugin.name)) {
      console.warn(`Duplicate plugin name registered: ${plugin.name}`);
    }

    this.plugins.push(plugin);
    return this;
  }

  /**
   * Invokes setup for all registered plugins in insertion order.
   */
  setupAll(ctx: PluginContext): void {
    for (const plugin of this.plugins) {
      plugin.setup(ctx);
    }
  }

  /**
   * Returns plugin names in registration order.
   */
  getNames(): string[] {
    return this.plugins.map((plugin) => plugin.name);
  }
}
