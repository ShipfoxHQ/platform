export const darkClass = 'dark:text-white';
const templateClass = `dark:bg-black ${'text-white'}`;

export function RejectedTheme() {
  return <div className={`bg-background-neutral-base ${templateClass}`}>Content</div>;
}
