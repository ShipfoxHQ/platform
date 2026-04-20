/// <reference types="@shipfox/vite/client" />

import './styles.css';

import {AuthProvider} from '@shipfox/client-auth';
import {RouterProvider, router} from '@shipfox/client-router';
import {ThemeProvider, Toaster, TooltipProvider} from '@shipfox/react-ui';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

const element = document.getElementById('app');
if (!element) throw new Error('No element with id "app" found');

createRoot(element).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <AuthProvider>
          <RouterProvider router={router} />
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
