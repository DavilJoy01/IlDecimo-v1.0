// mobile/src/utils/profileDisplay.test.ts
import { calculateAge, FOOT_LABELS, ROLE_LABELS } from './profileDisplay';

describe('profileDisplay', () => {
  describe('calculateAge', () => {
    it('computes age when the birthday has already passed this year', () => {
      const today = new Date();
      const birthYear = today.getFullYear() - 30;
      const pastMonth = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      pastMonth.setMonth(pastMonth.getMonth() - 1);
      const birthDate = `${birthYear}-${String(pastMonth.getMonth() + 1).padStart(2, '0')}-${String(pastMonth.getDate()).padStart(2, '0')}`;

      expect(calculateAge(birthDate)).toBe(30);
    });

    it('subtracts one year when the birthday has not happened yet this year', () => {
      const today = new Date();
      const birthYear = today.getFullYear() - 30;
      const futureMonth = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      futureMonth.setMonth(futureMonth.getMonth() + 1);
      const birthDate = `${birthYear}-${String(futureMonth.getMonth() + 1).padStart(2, '0')}-${String(futureMonth.getDate()).padStart(2, '0')}`;

      expect(calculateAge(birthDate)).toBe(29);
    });
  });

  describe('FOOT_LABELS / ROLE_LABELS', () => {
    it('maps every known foot/role value to its Italian label', () => {
      expect(FOOT_LABELS.left).toBe('Sinistro');
      expect(FOOT_LABELS.right).toBe('Destro');
      expect(FOOT_LABELS.both).toBe('Entrambi');
      expect(ROLE_LABELS.player).toBe('Giocatore');
      expect(ROLE_LABELS.goalkeeper).toBe('Portiere');
      expect(ROLE_LABELS.both).toBe('Entrambi');
    });
  });
});
