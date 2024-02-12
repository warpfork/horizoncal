import {
	App,
	PluginSettingTab,
	Setting
} from 'obsidian';

import { HorizonCalPlugin } from './main';

export interface HorizonCalSettings {
	mySetting: string;
}

export const DEFAULT_SETTINGS: HorizonCalSettings = {
	mySetting: 'default'
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

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
