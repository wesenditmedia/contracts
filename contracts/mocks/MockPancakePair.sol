// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockPancakePair {
    constructor() {}

    function swap(
        address token,
        address to,
        uint256 amountOutMin
    ) public {
        IERC20(token).transfer(to, amountOutMin);
    }
}
