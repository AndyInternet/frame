package main

import "fmt"

type Color int

const (
	Red Color = iota
	Green
	Blue
	Yellow
)

type Serializer interface {
	Serialize() ([]byte, error)
	Deserialize(data []byte) error
}

type User struct {
	ID        int64  `json:"id" db:"id"`
	Name      string `json:"name" db:"name"`
	Email     string `json:"email" db:"email"`
	IsActive  bool   `json:"is_active" db:"is_active"`
}

func (u *User) Serialize() ([]byte, error) {
	return fmt.Appendf(nil, "%d:%s:%s", u.ID, u.Name, u.Email), nil
}

func (u *User) Validate() error {
	if u.Name == "" {
		return fmt.Errorf("name is required")
	}
	if u.Email == "" {
		return fmt.Errorf("email is required")
	}
	return nil
}

func NewUser(id int64, name, email string) *User {
	return &User{
		ID:       id,
		Name:     name,
		Email:    email,
		IsActive: true,
	}
}
