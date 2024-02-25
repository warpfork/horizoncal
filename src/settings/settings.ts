import {
	App,
	PluginSettingTab,
	Setting
} from 'obsidian';

import HorizonCalPlugin from '../main';

export interface HorizonCalSettings {
	prefixPath: string;
	categories: string[];
}

export const DEFAULT_SETTINGS: HorizonCalSettings = {
	prefixPath: 'horizoncal',
	categories: ["meeting", "urgent", "travel", "project", "social"],
}

export class HorizonCalSettingsTab extends PluginSettingTab {
	plugin: HorizonCalPlugin;

	constructor(app: App, plugin: HorizonCalPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h1", { text: "HorizonCal Settings" });

		let foo: DocumentFragment;

		new Setting(containerEl)
			.setName("Prefix Path")
			.setDesc(createFragment(el => {
				el.appendText("Directory in your vault wherein HorizonCal should store all data.");
				el.createEl("br");
				el.createEl("br");
				el.appendText("(Don't include a trailing slash.)");
			}))
			.addText(text => text
				.setPlaceholder("horizoncal")
				.setValue(this.plugin.settings.prefixPath)
				.onChange(async (value) => {
					this.plugin.settings.prefixPath = value;
					await this.plugin.saveSettings();
				}));
	}
}
