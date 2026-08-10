export const darkClass = 'dark:text-white';
export const splitPrefix = 'dark:';
export const splitTemplateClass = `dark:${'bg-black'}`;
const templateClass = `dark:bg-black ${'text-white'}`;

export function RejectedTheme() {
  return <div className={`bg-background-neutral-base ${templateClass}`}>Content</div>;
}
