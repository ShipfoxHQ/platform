import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {SlugChangeWarning, SlugField} from './slug-field.js';

describe('SlugField', () => {
  test('does not check an untouched or invalid value', async () => {
    const checkAvailability = vi.fn().mockResolvedValue(true);

    render(
      <SlugField
        id="slug"
        label="Slug"
        value="derived-value"
        onChange={vi.fn()}
        onBlur={vi.fn()}
        checkEnabled={false}
        isValid={() => true}
        checkAvailability={checkAvailability}
      />,
    );

    expect(screen.getByLabelText('Slug')).toHaveValue('derived-value');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(checkAvailability).not.toHaveBeenCalled();
    expect(screen.queryByText('Slug is available.')).not.toBeInTheDocument();
  });

  test('does not check an invalid value when checking is enabled', async () => {
    const checkAvailability = vi.fn().mockResolvedValue(true);

    render(
      <SlugField
        id="slug"
        label="Slug"
        value="invalid value"
        onChange={vi.fn()}
        onBlur={vi.fn()}
        isValid={() => false}
        checkAvailability={checkAvailability}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(checkAvailability).not.toHaveBeenCalled();
    expect(screen.queryByText('Checking availability…')).not.toBeInTheDocument();
  });

  test('shows checking before the availability result and renders a conflict', async () => {
    let resolveAvailability!: (available: boolean) => void;
    const checkAvailability = vi.fn(
      () => new Promise<boolean>((resolve) => (resolveAvailability = resolve)),
    );

    render(
      <SlugField
        id="slug"
        label="Slug"
        value="taken-value"
        onChange={vi.fn()}
        onBlur={vi.fn()}
        debounceMs={5}
        isValid={() => true}
        checkAvailability={checkAvailability}
      />,
    );

    await waitFor(() => expect(checkAvailability).toHaveBeenCalledWith('taken-value'));
    expect(screen.getByText('Checking availability…')).toBeInTheDocument();
    expect(screen.queryByText('Slug is available.')).not.toBeInTheDocument();

    resolveAvailability(false);

    const conflict = await screen.findByText('This slug is already taken.');
    expect(conflict).toBeInTheDocument();
    expect(conflict).toHaveAttribute('aria-live', 'polite');
  });

  test('warns about all consequences of changing a slug', () => {
    render(
      <SlugChangeWarning open onOpenChange={vi.fn()} entityLabel="project" onConfirm={vi.fn()} />,
    );

    expect(screen.getByRole('dialog')).toHaveTextContent('old URL stop working');
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'old slug becomes available for someone else to take',
    );
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'slug has been written down by hand needs updating',
    );
  });

  test('does not check the current entity slug', async () => {
    const checkAvailability = vi.fn().mockResolvedValue(true);

    render(
      <SlugField
        id="slug"
        label="Slug"
        value="current-value"
        currentSlug="current-value"
        onChange={vi.fn()}
        onBlur={vi.fn()}
        isValid={() => true}
        checkAvailability={checkAvailability}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(checkAvailability).not.toHaveBeenCalled();
    expect(screen.queryByText('Slug is available.')).not.toBeInTheDocument();
  });

  test('passes input changes through to the form field', () => {
    const onChange = vi.fn();
    render(
      <SlugField
        id="slug"
        label="Slug"
        value="current-value"
        onChange={onChange}
        onBlur={vi.fn()}
        checkEnabled={false}
        isValid={() => true}
        checkAvailability={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Slug'), {target: {value: 'next-value'}});
    expect(onChange).toHaveBeenCalledWith('next-value');
  });
});
