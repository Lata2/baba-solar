import { describe, expect, it } from 'vitest'
import { mockApi } from '@/mocks/mockApi'
import { SERVER_MODE } from '@/config/api'
import { createSeedDb } from '@/mocks/store'

describe('static-build authentication boundary', () => {
  it('does not treat the mock API as an authentication provider', async () => {
    expect(SERVER_MODE).toBe(false)
    await expect(mockApi.login('admin@example.com', 'password')).rejects.toMatchObject({
      code: 'network',
      status: 503,
    })
  })

  it('does not restore a client-side session or mutate users without the server', async () => {
    await expect(mockApi.me()).rejects.toMatchObject({ code: 'network', status: 503 })
    await expect(mockApi.listUsers()).rejects.toMatchObject({ code: 'network', status: 503 })
    await expect(mockApi.createUser({
      name: 'Test',
      email: 'test@example.com',
      role: 'admin',
      password: 'NotStored123!',
    })).rejects.toMatchObject({ code: 'network', status: 503 })
    await expect(mockApi.logout()).resolves.toBeUndefined()
  })

  it('does not claim to submit or persist personal enquiry and quote data without a delivery API', async () => {
    await expect(mockApi.submitEnquiry({
      name: 'Test Person',
      phone: '9876512345',
      email: 'test@example.com',
      city: 'Raipur',
      service: 'Solar installation',
      message: 'Please contact me about solar.',
      source: 'contact',
    })).rejects.toMatchObject({ code: 'network', status: 503 })
    await expect(mockApi.submitQuotation({
      customerName: 'Test Person',
      phone: '9876512345',
      email: 'test@example.com',
      city: 'Raipur',
      propertyType: 'residential',
      systemType: 'on-grid',
      capacityKw: 3,
      monthlyBill: 3000,
    })).rejects.toMatchObject({ code: 'network', status: 503 })

    const seed = createSeedDb()
    expect(seed.enquiries).toHaveLength(0)
    expect(seed.users).toHaveLength(0)
  })
})
