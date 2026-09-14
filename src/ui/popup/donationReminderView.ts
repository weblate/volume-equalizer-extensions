import { attachModalFocus } from "./modalFocus";
import {
  getNextDonationReminderAt,
  isDonationReminderDue,
} from "../../domains/donation/donationReminder";
import { STORAGE_KEYS } from "../../infrastructure/chrome/storageKeys";

export const createDonationReminderView = (deps: {
  modal: HTMLElement;
  closeButton: HTMLElement;
  returnFocusTo: HTMLElement;
  now?: () => number;
  random?: () => number;
}) => {
  const modalFocus = attachModalFocus(deps.modal, deps.returnFocusTo);
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;

  deps.closeButton.addEventListener("click", modalFocus.close);
  deps.modal.addEventListener("modal-closed", () => {
    void chrome.storage.local.set({
      [STORAGE_KEYS.DONATION_REMINDER_AT]: getNextDonationReminderAt(now(), random()),
    });
  });

  return {
    showDonationReminder: (nextReminderAt: unknown) => {
      if (isDonationReminderDue(nextReminderAt, now())) {
        modalFocus.open();
        deps.closeButton.focus();
      }
    },
  };
};
