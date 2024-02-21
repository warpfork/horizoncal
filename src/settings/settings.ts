import {
	App,
	PluginSettingTab,
	Setting
} from 'obsidian';

import HorizonCalPlugin from '../main';

export interface HorizonCalSettings {
	prefixPath: string;
}

export const DEFAULT_SETTINGS: HorizonCalSettings = {
	prefixPath: 'horizoncal'
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
			.setName('Prefix Path')
			.setDesc('Directory in your vault HorizonCal should store all data.')
			.addText(text => text
				.setPlaceholder('horizoncal')
				.setValue(this.plugin.settings.prefixPath)
				.onChange(async (value) => {
					this.plugin.settings.prefixPath = value;
					await this.plugin.saveSettings();
				}));
	}
}
