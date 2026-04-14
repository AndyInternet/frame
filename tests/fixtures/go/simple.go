package main

import (
	"fmt"
	"errors"
)

func Greet(name string) string {
	return fmt.Sprintf("Hello, %s!", name)
}

func Add(a, b int) int {
	return a + b
}

func Divide(a, b float64) (float64, error) {
	if b == 0 {
		return 0, errors.New("division by zero")
	}
	return a / b, nil
}

func internalHelper() {
	fmt.Println("not exported")
}
