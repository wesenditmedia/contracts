// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title WeSendit token sender
 */
contract WeSenditSender is Ownable {
    IERC20 private _token;

    constructor(address token) {
        _token = IERC20(token);
    }

    function transferBulk(
        address[] calldata addresses,
        uint256[] calldata amounts
    ) external onlyOwner returns (bool) {
        require(
            addresses.length == amounts.length,
            "WeSenditSender: mismatching addresses / amounts pair"
        );

        for (uint256 i = 0; i < addresses.length; i++) {
            require(
                _token.transferFrom(_msgSender(), addresses[i], amounts[i])
            );
        }

        return true;
    }
}
