import {
	App,
	PluginSettingTab,
	Setting
} from 'obsidian';

import HorizonCalPlugin from '../main';
import { EventCategorySettings } from './categories';

export interface HorizonCalSettings {
	prefixPath: string;
	categories: EventCategorySettings;
}

export const DEFAULT_SETTINGS: HorizonCalSettings = {
	prefixPath: 'horizoncal',
	categories: {
		"due": {
			color: "#FF0000",
			effectPriority: 10,
		},
		"meeting": {
			color: "#5DDD44",
		},
		"project": {
			color: "#3874EB"
		},
		"social": {
			color: "#FFEC6E",
		},
		"travel": {
			color: "#555555",
		},
	},
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
