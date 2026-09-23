## The key architectural principle

                    ┌─────────────────────┐
                    │  Identity Platform  │
                    │                     │
                    │ Users               │
                    │ Tenants             │
                    │ Memberships         │
                    │ OAuth/OIDC          │
                    │ Sessions            │
                    │ Entitlements        │
                    └──────────┬──────────┘
                               │
                     standardized contract
                               │
              ┌────────────────┴────────────────┐
              │                                 │
        ┌─────▼─────┐                    ┌──────▼─────┐
        │ TravelOS  │                    │ Healthcare │
        │           │                    │            │
        │ Business  │                    │ Business   │
        │ IAM       │                    │ IAM        │
        └───────────┘                    └────────────┘

## target state

                 CTC Identity Platform
                         │
          ┌──────────────┼──────────────┐
          │              │              │
          ▼              ▼              ▼
       TravelOS       Banking AI     QueueStream
       Product         Product        Product
          │              │              │
          ▼              ▼              ▼
       Travel IAM    Banking IAM    Queue IAM

## Identity owns the common layer

                    IDENTITY
                       │
       ┌───────────────┼────────────────┐
       │               │                │
     User            Tenant           Membership
       │               │                │
       └───────────────┼────────────────┘
                       │
                  Product Access
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
       TravelOS     Banking AI   QueueStream
          │            │            │
       Product       Product      Product
       Roles         Roles        Roles
       Permissions   Permissions  Permissions