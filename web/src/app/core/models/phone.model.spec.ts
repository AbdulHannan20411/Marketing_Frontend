import { countryConflict, countryOfNumber, describeCountries } from './phone.model';
/**
 * The mistake this closes: United States (+1) chosen, `+923365471147` pasted.
 *
 * Nothing downstream can find it. The number saves exactly as typed, the
 * country saves exactly as chosen, and the stored row holds no contradiction —
 * just a contact filed under a country it has nothing to do with, which makes
 * every audience and report built by country quietly wrong.
 */
describe('country against the number it was chosen for', () => {
  it('names the country the number actually belongs to', () => {
    const conflict = countryConflict('+923365471147', 'US');

    expect(conflict).not.toBeNull();
    expect(conflict!.dial).toBe('92');
    expect(conflict!.countries.map((entry) => entry.iso)).toEqual(['PK']);
    expect(conflict!.selected.name).toBe('United States');
  });

  it('agrees when they match, however the country was written', () => {
    expect(countryConflict('+923365471147', 'PK')).toBeNull();
    expect(countryConflict('+923365471147', 'Pakistan')).toBeNull();
    expect(countryConflict('923365471147', 'pk')).toBeNull();
  });

  it('does not flag a shared dialling code', () => {
    // The United States and Canada are both +1, and the digits cannot tell
    // them apart — so a Canadian number with the US chosen is not a conflict
    // anything here can see, and pretending otherwise would block a valid save.
    expect(countryConflict('+14165551234', 'US')).toBeNull();
    expect(countryConflict('+12125551234', 'CA')).toBeNull();
  });

  it('says so in words, including where a code is shared', () => {
    expect(describeCountries(countryConflict('+923365471147', 'US')!.countries)).toBe('Pakistan');
    expect(
      describeCountries([
        { iso: 'US', name: 'United States', dial: '1' },
        { iso: 'CA', name: 'Canada', dial: '1' },
      ]),
    ).toBe('United States or Canada');
  });

  it('leaves a national number alone', () => {
    // `0336…` carries no country of its own — the chosen country is what
    // supplies the code, which is the normal flow and not a contradiction.
    expect(countryConflict('03365471147', 'US')).toBeNull();
    expect(countryOfNumber('03365471147')).toBeNull();
  });

  it('reads through an exit prefix', () => {
    // `0092…` is `+92…` dialled from a landline.
    expect(countryConflict('00923365471147', 'US')?.dial).toBe('92');
  });

  it('is silent when either side is unknown', () => {
    expect(countryConflict('+923365471147', '')).toBeNull();
    expect(countryConflict('+923365471147', 'Atlantis')).toBeNull();
    // A dialling code this app does not list: no detection, so no claim.
    expect(countryConflict('+6985551234', 'US')).toBeNull();
  });

  it('prefers the longest matching code', () => {
    // `1` must not claim a number that belongs to a longer code starting with
    // the same digit.
    expect(countryOfNumber('+35312345678')?.iso).toBe('IE');
  });
});
