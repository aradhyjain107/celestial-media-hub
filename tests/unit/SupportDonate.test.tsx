import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, describe, test, vi, beforeEach } from 'vitest';
import { SupportDonateFooter, SupportModal, SidebarSupportTrigger } from '../../app/components/ui/SupportDonate';

describe('SupportDonate UPI Components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  test('renders SupportDonateFooter with creator attribution, UPI ID, and QR code', () => {
    render(<SupportDonateFooter />);

    expect(screen.getByText('100% FREE FOREVER')).toBeInTheDocument();
    expect(screen.getByText('BUILT BY ARADHY')).toBeInTheDocument();
    expect(screen.getByText('Enjoying Celestial Media Hub? Support via UPI')).toBeInTheDocument();
    expect(screen.getByText('8791979936@fam')).toBeInTheDocument();

    const qrImg = screen.getByAltText(/Scan UPI QR/i);
    expect(qrImg).toHaveAttribute('src', '/upi-qr.png');
  });

  test('copies UPI ID to clipboard and shows COPIED feedback in footer', async () => {
    render(<SupportDonateFooter />);
    const copyBtn = screen.getByTestId('footer-copy-upi-btn');
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('8791979936@fam');
      expect(copyBtn).toHaveTextContent('COPIED ✓');
    });
  });

  test('SupportModal opens via SidebarSupportTrigger and dynamically updates QR code + UPI deep link for ₹50, presets, and custom amounts', () => {
    render(<SidebarSupportTrigger />);

    const trigger = screen.getByTestId('sidebar-donate-btn');
    fireEvent.click(trigger);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Support Aradhy')).toBeInTheDocument();

    const qrSvg = screen.getByTestId('dynamic-upi-qr');
    const qrBadge = screen.getByTestId('qr-amount-badge');
    const deepLink = screen.getByTestId('upi-deep-link');

    // Default ₹99 preset
    expect(qrSvg).toHaveAttribute('data-upi-uri', 'upi://pay?pa=8791979936@fam&pn=Vaibhav%20Rawat&am=99&cu=INR');
    expect(qrBadge).toHaveTextContent('QR PRE-LOADED: ₹99');
    expect(deepLink).toHaveAttribute('href', expect.stringContaining('pa=8791979936%40fam'));
    expect(deepLink).toHaveAttribute('href', expect.stringContaining('am=99'));
    const initialQrMarkup = qrSvg.innerHTML;

    // Select ₹50 preset — QR matrix and URI must update to pre-load ₹50
    fireEvent.click(screen.getByText('₹50'));
    expect(qrSvg).toHaveAttribute('data-upi-uri', 'upi://pay?pa=8791979936@fam&pn=Vaibhav%20Rawat&am=50&cu=INR');
    expect(qrSvg).toHaveAttribute('data-amount', '50');
    expect(qrBadge).toHaveTextContent('QR PRE-LOADED: ₹50');
    expect(deepLink).toHaveAttribute('href', expect.stringContaining('am=50'));
    expect(deepLink).toHaveTextContent('PAY ₹50 VIA UPI APP →');
    const qrMarkup50 = qrSvg.innerHTML;
    expect(qrMarkup50).not.toEqual(initialQrMarkup);

    // Select ₹249 preset
    fireEvent.click(screen.getByText('₹249'));
    expect(qrSvg).toHaveAttribute('data-upi-uri', 'upi://pay?pa=8791979936@fam&pn=Vaibhav%20Rawat&am=249&cu=INR');
    expect(deepLink).toHaveAttribute('href', expect.stringContaining('am=249'));

    // Select ANY preset — omits am= so user can type any amount in UPI app
    fireEvent.click(screen.getByText('ANY'));
    expect(qrSvg).toHaveAttribute('data-upi-uri', 'upi://pay?pa=8791979936@fam');
    expect(qrBadge).toHaveTextContent('QR MODE: ANY AMOUNT');
    expect(deepLink).not.toHaveAttribute('href', expect.stringContaining('am='));

    // Enter a custom amount (₹150)
    const customInput = screen.getByTestId('custom-upi-amount-input');
    fireEvent.change(customInput, { target: { value: '150' } });
    expect(qrSvg).toHaveAttribute('data-upi-uri', 'upi://pay?pa=8791979936@fam&pn=Vaibhav%20Rawat&am=150&cu=INR');
    expect(qrBadge).toHaveTextContent('QR PRE-LOADED: ₹150');
    expect(deepLink).toHaveAttribute('href', expect.stringContaining('am=150'));
  });

  test('SupportModal closes when pressing Escape or close button', () => {
    const onClose = vi.fn();
    render(<SupportModal open={true} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('Close support modal'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
