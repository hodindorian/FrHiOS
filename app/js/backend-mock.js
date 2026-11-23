// Backend de démonstration : de faux appareils, pour développer l'interface
// sans Home Assistant. Il expose exactement la même interface que backend-ha.js :
//   connect(), close(), getEntities(), call(domain, service, entityId, data),
//   onChange(cb), onStatus(cb)
//
// Format d'une entité (identique à celui d'Home Assistant, simplifié) :
//   { id, name, domain, state: 'on'|'off', room, attributes: {...} }

const RGB_LED = ['rgb', 'color_temp'];

const seed = () => [
  { id: 'light.led_salon', name: 'LEDs salon', domain: 'light', state: 'on', room: 'Salon',
    attributes: { brightness: 190, rgb_color: [255, 140, 60], supported_color_modes: RGB_LED } },
  { id: 'light.ampoule_tapo', name: 'Ampoule Tapo', domain: 'light', state: 'off', room: 'Salon',
    attributes: { brightness: 255, rgb_color: [255, 255, 255], supported_color_modes: RGB_LED } },
  { id: 'light.led_chambre', name: 'LEDs chambre', domain: 'light', state: 'off', room: 'Chambre',
    attributes: { brightness: 120, rgb_color: [120, 90, 255], supported_color_modes: RGB_LED } },
  { id: 'switch.prise_cafetiere', name: 'Prise cafetière', domain: 'switch', state: 'off', room: 'Cuisine',
    attributes: {} },
  { id: 'switch.prise_ventilo', name: 'Prise ventilateur', domain: 'switch', state: 'on', room: 'Chambre',
    attributes: {} },
  { id: 'media_player.tv_philips', name: 'TV Philips 55OLED809', domain: 'media_player', state: 'off', room: 'Salon',
    attributes: { volume_level: 0.25, is_volume_muted: false } },
  { id: 'remote.tv_philips', name: 'Télécommande TV Philips', domain: 'remote', state: 'off', room: 'Salon',
    attributes: {} },
];

const kelvinToRgb = (k) => {
  // Approximation suffisante pour l'aperçu de la démo
  const t = Math.min(Math.max(k, 2000), 6500);
  const warm = (6500 - t) / 4500;
  return [255, Math.round(255 - warm * 90), Math.round(255 - warm * 190)];
};

export class MockBackend {
  constructor() {
    this.entities = seed();
    this.changeCbs = new Set();
    this.statusCbs = new Set();
  }

  onChange(cb) { this.changeCbs.add(cb); }
  onStatus(cb) { this.statusCbs.add(cb); }
  #emit() { this.changeCbs.forEach((cb) => cb()); }

  async connect() {
    this.statusCbs.forEach((cb) => cb('demo', 'Mode démo'));
  }

  close() {}

  getEntities() { return this.entities; }

  async call(domain, service, entityId, data = {}) {
    const e = this.entities.find((x) => x.id === entityId);
    if (!e) return;

    if (service === 'toggle') service = e.state === 'on' ? 'turn_off' : 'turn_on';

    if (service === 'turn_off') e.state = 'off';

    if (service === 'turn_on') {
      e.state = 'on';
      if (data.brightness_pct != null) e.attributes.brightness = Math.round(data.brightness_pct * 2.55);
      if (data.rgb_color) e.attributes.rgb_color = data.rgb_color;
      if (data.color_temp_kelvin) e.attributes.rgb_color = kelvinToRgb(data.color_temp_kelvin);
    }

    if (domain === 'media_player') {
      const v = e.attributes.volume_level ?? 0.2;
      if (service === 'volume_up') e.attributes.volume_level = Math.min(1, v + 0.05);
      if (service === 'volume_down') e.attributes.volume_level = Math.max(0, v - 0.05);
      if (service === 'volume_mute') e.attributes.is_volume_muted = !e.attributes.is_volume_muted;
    }

    // Garder la télécommande et le lecteur de la TV synchronisés
    if (entityId === 'media_player.tv_philips' || entityId === 'remote.tv_philips') {
      const state = this.entities.find((x) => x.id === entityId).state;
      this.entities.forEach((x) => { if (x.id.endsWith('tv_philips')) x.state = state; });
    }

    this.#emit();
  }
}
