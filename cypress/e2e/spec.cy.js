// const SERVER_URL = 'http://127.0.0.1:17447'
const SERVER_URL = 'https://fa.mpeschel10.com'

// describe('template spec', () => {
//   it('passes', () => {
//     cy.visit('https://example.cypress.io')
//   })
// })

describe('My First Test', () => {
  it('Does not do much!', async () => {
    const result = await fetch(SERVER_URL + '/users.json', {
      method: 'PUT'
    });
    expect(result.status).to.equal(401);
  })
})
